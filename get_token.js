const { google } = require('googleapis');
const readline = require('readline');
require('dotenv').config();

const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    'http://localhost:3000/oauth2callback'
);

const scopes = [
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.force-ssl'
];

const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes
});

console.log('다음 URL을 브라우저에서 열어주세요:');
console.log(authUrl);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('인증 코드를 입력하세요: ', async (code) => {
    try {
        const { tokens } = await oauth2Client.getToken(code);
        console.log('\n발급받은 토큰:');
        console.log('Access Token:', tokens.access_token);
        console.log('Refresh Token:', tokens.refresh_token);
        
        // .env 파일에 토큰 저장
        const fs = require('fs');
        const envPath = '.env';
        let envContent = fs.readFileSync(envPath, 'utf8');
        
        envContent = envContent.replace(
            /YOUTUBE_ACCESS_TOKEN=.*/,
            `YOUTUBE_ACCESS_TOKEN=${tokens.access_token}`
        );
        envContent = envContent.replace(
            /YOUTUBE_REFRESH_TOKEN=.*/,
            `YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}`
        );
        
        fs.writeFileSync(envPath, envContent);
        console.log('\n.env 파일이 업데이트되었습니다.');
    } catch (error) {
        console.error('토큰 발급 중 오류가 발생했습니다:', error);
    }
    rl.close();
}); 