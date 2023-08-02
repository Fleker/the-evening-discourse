import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'
// Initialize Firebase
admin.initializeApp(functions.config().firebase);
const bucket = admin.storage().bucket('evening-discourse')

import * as ffmpeg from 'fluent-ffmpeg'
import {File, Bucket} from '@google-cloud/storage'
import * as os from 'os'
import * as path from 'path'

// Requires uploading two wav files and putting them in Google Cloud Storage.
// But this shouldn't be required to get the code uploaded. (The cron would just crash when run).
async function convertInstapaperToMp3() {
  await concatTTSPieces(bucket, ['intro.wav', 'ending.wav'], `final-name.mp3`)
}

// Run each hour on the 50th minute
export const instapaperTts = functions.pubsub.schedule('50 */1 * * *')
  .onRun(async () => {
    return await convertInstapaperToMp3();
});

async function tmpDownloadFile(file: File, tmpFilename: string) {
  await file.download({ destination: tmpFilename })
}

async function concatTTSPieces(bucket: Bucket, concats: string[], finalFile: string) {
  const introFile = bucket.file('intro.wav')
  await tmpDownloadFile(introFile, path.join(os.tmpdir(), 'intro.wav'))
  concats.unshift(path.join(os.tmpdir(), 'intro.wav'))

  const endingFile = bucket.file('ending.wav')
  await tmpDownloadFile(endingFile, path.join(os.tmpdir(), 'ending.wav'))
  concats.push(path.join(os.tmpdir(), 'ending.wav'))

  return new Promise((res, rej) => {
    console.log(`Concat (${concats.length}) - ${concats.join(',')}`)
    const cmd = ffmpeg()
    concats.forEach(c => cmd.input(c) )
    cmd.on('end', () => {
      res('ok')
    })
    .on('error', (err: any) => {
      console.error(err.message)
      rej(err.message)
    })
    .mergeToFile(path.join(os.tmpdir(), finalFile), os.tmpdir())
  })
}
