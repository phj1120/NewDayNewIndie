const { google } = require('googleapis');
require('dotenv').config();

async function checkPermissions() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: process.env.YOUTUBE_ACCESS_TOKEN,
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
  });

  const youtube = google.youtube({
    version: 'v3',
    auth: oauth2Client
  });

  try {
    // 채널 정보 조회 (기본 권한)
    const channelResponse = await youtube.channels.list({
      part: 'snippet',
      id: process.env.YOUTUBE_CHANNEL_ID
    });
    
    if (channelResponse.data.items && channelResponse.data.items.length > 0) {
      console.log('채널 정보 조회 성공:', channelResponse.data.items[0].snippet.title);
    } else {
      console.log('채널 정보가 없습니다.');
      return;
    }

    // 플레이리스트 생성 시도 (쓰기 권한)
    const playlistResponse = await youtube.playlists.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: 'Test Playlist',
          description: 'Test playlist created by DailyPli'
        },
        status: {
          privacyStatus: 'private'
        }
      }
    });
    console.log('플레이리스트 생성 성공:', playlistResponse.data.id);

    // 생성된 플레이리스트 삭제
    await youtube.playlists.delete({
      id: playlistResponse.data.id
    });
    console.log('플레이리스트 삭제 성공');

  } catch (error) {
    console.error('권한 확인 중 오류 발생:', error.message);
    if (error.response) {
      console.error('상세 오류:', error.response.data);
    }
  }
}

checkPermissions(); 