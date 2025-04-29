const { google } = require('googleapis');
require('dotenv').config();

async function checkScopes() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: process.env.YOUTUBE_ACCESS_TOKEN,
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
  });

  try {
    // 토큰 정보 조회
    const tokenInfo = await oauth2Client.getTokenInfo(process.env.YOUTUBE_ACCESS_TOKEN);
    console.log('할당된 스코프:', tokenInfo.scopes);
  } catch (error) {
    console.error('스코프 확인 중 오류 발생:', error.message);
    if (error.response) {
      console.error('상세 오류:', error.response.data);
    }
  }
}

checkScopes(); 