# DailyPli

YouTube 채널의 최신 동영상을 자동으로 플레이리스트에 추가하는 프로젝트입니다.

## 기능

- 지정된 YouTube 채널의 최신 동영상을 자동으로 감지
- 매일 자정에 플레이리스트 업데이트
- GitHub Actions를 통한 자동화된 실행

## 설정 방법

1. GitHub 저장소를 포크하거나 클론합니다.
2. YouTube Data API 키를 발급받습니다.
3. OAuth2 클라이언트 ID와 시크릿을 생성합니다.
4. GitHub Secrets에 다음 환경 변수들을 추가합니다:
   - `YOUTUBE_API_KEY`
   - `YOUTUBE_CLIENT_ID`
   - `YOUTUBE_CLIENT_SECRET`
   - `YOUTUBE_REDIRECT_URI`
   - `YOUTUBE_ACCESS_TOKEN`
   - `YOUTUBE_REFRESH_TOKEN`
   - `YOUTUBE_CHANNEL_ID`
   - `YOUTUBE_PLAYLIST_ID`

## 실행 방법

- 자동 실행: GitHub Actions가 매일 자정에 자동으로 실행됩니다.
- 수동 실행: GitHub Actions 탭에서 워크플로우를 수동으로 실행할 수 있습니다.

## 라이선스

MIT 