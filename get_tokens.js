const { google } = require('googleapis');
const readline = require('readline');

// OAuth2 클라이언트 설정
const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
);

// 인증 URL 생성
const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
        'https://www.googleapis.com/auth/youtube',
        'https://www.googleapis.com/auth/youtube.force-ssl'
    ]
});

console.log('다음 URL을 브라우저에서 열고 인증을 완료하세요:');
console.log(authUrl);

// 인증 코드 입력 받기
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('인증 코드를 입력하세요: ', async (code) => {
    try {
        const { tokens } = await oauth2Client.getToken(code);
        console.log('\n다음 토큰들을 GitHub Secrets에 저장하세요:');
        console.log('YOUTUBE_ACCESS_TOKEN:', tokens.access_token);
        console.log('YOUTUBE_REFRESH_TOKEN:', tokens.refresh_token);
    } catch (error) {
        console.error('토큰 생성 중 오류가 발생했습니다:', error);
    }
    rl.close();
}); 