// GitHub Pages(정적)에서 API 서버 주소를 주입하기 위한 설정 파일입니다.
// - 기본값: 현재 origin(같은 도메인) → 로컬/단일 서버 개발 시 편리
// - 분리 배포 시: 아래 API_URL에 Render 백엔드 주소를 넣어주세요.
//
// 예)
// window.API_URL = 'https://your-new-render-url.onrender.com';
//
// NOTE: 끝의 '/'는 있어도 자동으로 제거됩니다.
window.API_URL = window.API_URL || '';

