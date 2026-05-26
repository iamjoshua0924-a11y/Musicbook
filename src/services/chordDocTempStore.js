// chord 문서 임시 in-memory 저장소 (DB 장애/지연 시 fallback)
// - Render에서 Mongo가 순간적으로 느리거나 끊기면 /api/proxy-chord 가 502로 터질 수 있어,
//   일정 시간 동안은 메모리에 저장 후 docId로 조회 가능하게 한다.

const store = new Map(); // docId -> { expireAt, value }

function setTempDoc(docId, value, ttlMs = 60 * 60 * 1000) {
  store.set(String(docId), { expireAt: Date.now() + Number(ttlMs || 0), value });
}

function getTempDoc(docId) {
  const key = String(docId);
  const v = store.get(key);
  if (!v) return null;
  if (Date.now() > v.expireAt) {
    store.delete(key);
    return null;
  }
  return v.value;
}

module.exports = { setTempDoc, getTempDoc };

