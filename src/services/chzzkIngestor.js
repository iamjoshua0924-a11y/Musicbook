const { ChzzkModule } = require('chzzk-z');

/**
 * 치지직 채팅 Ingestor (PoC)
 * - admin이 start/stop으로 제어
 * - 라이브 상태를 주기적으로 확인하여 chatChannelId가 생기면 WebSocket 연결
 * - 채팅 메시지를 pollingEvent()로 가져와 lastMessage*에만 기록(신청곡 등록은 2차 단계)
 *
 * NOTE: 토큰/쿠키 값은 절대 로그로 출력하지 않는다.
 */
class ChzzkIngestor {
  constructor() {
    this.state = 'OFF'; // OFF | WAIT_LIVE | CONNECTING | CONNECTED | ERROR
    this.channelId = String(process.env.CHZZK_CHANNEL_ID || '').trim();
    this.chatChannelId = '';

    this.lastMessageAt = 0;
    this.lastMessagePreview = '';
    this.lastError = '';

    this._timer = null;
    this._module = null;
    this._stopRequested = false;
    this._connectStartedAt = 0;
  }

  getStatus() {
    return {
      ok: true,
      state: this.state,
      channelId: this.channelId || '',
      chatChannelId: this.chatChannelId || '',
      connected: Boolean(this._module?.chat?.connected),
      lastMessageAt: Number(this.lastMessageAt || 0),
      lastMessagePreview: String(this.lastMessagePreview || ''),
      lastError: String(this.lastError || '')
    };
  }

  async start() {
    if (this.state !== 'OFF') return this.getStatus();
    if (!this.channelId) {
      this.state = 'ERROR';
      this.lastError = 'CHZZK_CHANNEL_ID 환경변수가 필요합니다.';
      return this.getStatus();
    }

    this._stopRequested = false;
    this.lastError = '';
    await this._ensureModule();

    this.state = 'WAIT_LIVE';
    this._schedule(0);
    return this.getStatus();
  }

  async stop() {
    this._stopRequested = true;
    this._clearTimer();
    await this._disconnectChat();

    this.state = 'OFF';
    this.chatChannelId = '';
    this._connectStartedAt = 0;
    return this.getStatus();
  }

  // ---------------------------------------------------------------------------

  async _ensureModule() {
    if (this._module) return;
    this._module = new ChzzkModule();

    const aut = String(process.env.CHZZK_NID_AUT || '').trim();
    const ses = String(process.env.CHZZK_NID_SES || '').trim();

    // READ-only는 로그인 없이 될 때도 있으므로, 로그인 실패해도 PoC는 계속 진행한다.
    if (aut && ses) {
      try {
        await this._module.user.login(aut, ses);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[chzzk] user.login failed (continue as guest):', e?.message || e);
      }
    }
  }

  _clearTimer() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }

  _schedule(ms) {
    this._clearTimer();
    this._timer = setTimeout(() => this._tick().catch(() => {}), Math.max(0, Number(ms) || 0));
  }

  async _disconnectChat() {
    try {
      if (this._module?.chat?.connected) await this._module.chat.quit();
    } catch {}
  }

  async _tick() {
    if (this._stopRequested) return;
    if (!this._module) await this._ensureModule();

    try {
      // 1) 라이브 상태 확인 (chatChannelId가 있어야 채팅 WS 연결 가능)
      const status = await this._module.live.findStatusByChannelId(this.channelId);
      const chatChannelId = String(status?.chatChannelId || '').trim();

      if (!chatChannelId) {
        // 라이브가 꺼져있거나, chat 채널이 없는 상태
        this.chatChannelId = '';
        this.state = 'WAIT_LIVE';
        this._connectStartedAt = 0;
        await this._disconnectChat();
        return this._schedule(10_000);
      }

      this.chatChannelId = chatChannelId;

      // 2) WS 연결 확인/시도
      if (!this._module.chat.connected) {
        // CONNECTING 상태에서 너무 오래 걸리면 재시도
        if (!this._connectStartedAt) this._connectStartedAt = Date.now();
        const elapsed = Date.now() - this._connectStartedAt;
        if (elapsed > 15_000) {
          await this._disconnectChat();
          this._connectStartedAt = Date.now();
        }

        this.state = 'CONNECTING';
        // join은 내부에서 live-status/token을 다시 확인하고, ws를 연다.
        await this._module.chat.join(this.channelId);
        // 연결 완료까지 약간의 텀이 필요 (join이 ws open까지 await하지 않음)
        return this._schedule(800);
      }

      this._connectStartedAt = 0;
      this.state = 'CONNECTED';

      // 3) 수신 메시지 폴링
      const messages = this._module.chat.pollingEvent();
      if (Array.isArray(messages) && messages.length) {
        const last = messages[messages.length - 1];
        const nick = String(last?.profile?.nickname || last?.profile?.name || '').trim();
        const msg = String(last?.msg || '').trim();
        if (msg) {
          this.lastMessageAt = Date.now();
          this.lastMessagePreview = `${nick ? nick + ': ' : ''}${msg}`.slice(0, 120);
        }
      }

      return this._schedule(500);
    } catch (e) {
      this.state = 'ERROR';
      this.lastError = String(e?.message || e || 'UNKNOWN_ERROR');
      // eslint-disable-next-line no-console
      console.error('[chzzk] tick failed:', this.lastError);
      return this._schedule(5_000);
    }
  }
}

// Singleton
const chzzkIngestor = new ChzzkIngestor();

module.exports = { chzzkIngestor };
