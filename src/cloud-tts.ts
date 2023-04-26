import textToSpeech from '@google-cloud/text-to-speech'
import { google } from '@google-cloud/text-to-speech/build/protos/protos';
import credentials from '../functions/src/gcloud'
// Import other required libraries
import * as fs from 'fs';
import * as ffmpeg from 'fluent-ffmpeg'
import {Stream} from 'stream'
import {File} from '@google-cloud/storage'
import { getStorage } from 'firebase-admin/storage'
import { Article } from '../functions/src/instapaper-client';
import * as os from 'os'
import * as path from 'path'
const bucket = getStorage().bucket('evening-discourse')

const stdClient = new textToSpeech.TextToSpeechClient({
  credentials,
});

const CLOUD_TTS_MAX = 5000

export function textToArray(article: Article, fullText: string): string[] {
  const text = fullText
    .replace(/\t/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/U[.]S[.]/g, 'United States')
    .replace(/a\.m\./g, 'A M')
    .replace(/p\.m\./g, 'P M')
    .replace(/IEEE/g, 'I triple E')
    .replace(/(\d+)\.(\d+)/g, '$1 point $2')
    // Fix close-together punctuation
    .replace(/([.?!"“”])(\w)/g, '$1 $2')
    .replace(/(\w)([.?!"“”])/g, '$1 $2')
    .replace(/\s—/g, '. ')
    .replace(/[)],/g, ').')
    .replace(/;/g, '.')
    .replace(/[.,]["“”]/g, '". ')
    .replace(/\s[.]\s/g, '. ')
    .replace(/ - /g, '. ')
    .replace(/—/g, '. ')
    // NYTimes
    .replace("Send any friend a storyAs a subscriber, you have 10 gift articles to give each month. Anyone can read what you share.", '')
    .replace(`Send any friend a storyAs a subscriber, you have 10 gift articles to give each month . Anyone can read what you share .`, '')
    .replace(/IMAGE:/g, 'Image. ')

  console.log('Updated to', text)
  const content = text
  return (() => {
    const arr = [`${article.title}.`]
    let c = article.title.length
    const words = content.split(' ')
    for (const w of words) {
      if (c + w.length >= CLOUD_TTS_MAX) {
        arr.push(w)
        c = w.length + 2
      } else {
        arr[arr.length - 1] += ` ${w}`
        c += w.length + 2
      }
    }
    return arr
  })()
}

export async function generateTTSPiece(ssml: string, outputFile: string) {
  // Construct the request
  const request: google.cloud.texttospeech.v1.ISynthesizeSpeechRequest = {
    input: {text: ssml}, // TODO
    // Select the language and SSML voice gender (optional)
    // voice: {languageCode: 'en-US', name: 'en-US-Studio-O'},
    voice: {languageCode: 'en-US', name: 'en-US-Neural2-F'},
    // select the type of audio encoding
    audioConfig: {audioEncoding: 'MP3'},
  };
  console.log(outputFile, request)

  const [response] = await stdClient.synthesizeSpeech(request);
  // Write the binary audio content to a local file
  try {
    await fs.writeFileSync(path.join(os.tmpdir(), `${outputFile}.mp3`), response.audioContent, 'binary');
    console.log('tts promise resolved')
  } catch (e) {
    // throw e
  }
  return 0
}

export async function generateStdTTSPiece(ssml: string, outputFile: string) {
  // Construct the request
  const request: google.cloud.texttospeech.v1.ISynthesizeSpeechRequest = {
    input: {text: ssml}, // TODO
    // Select the language and SSML voice gender (optional)
    // voice: {languageCode: 'en-US', name: 'en-US-Studio-O'},
    voice: {languageCode: 'en-US', name: 'en-US-Standard-G'},
    // select the type of audio encoding
    audioConfig: {audioEncoding: 'MP3'},
  };
  console.log(outputFile, request)

  const [response] = await stdClient.synthesizeSpeech(request);
  // Write the binary audio content to a local file
  try {
    await fs.writeFileSync(path.join(os.tmpdir(), `${outputFile}.mp3`), response.audioContent, 'binary');
    console.log('tts promise resolved')
  } catch (e) {
    // throw e
  }
  return 0
}

export async function storeInCloud(filename: string, data: Buffer) {
  const file = bucket.file(filename)
  // https://cloud.google.com/storage/docs/samples/storage-stream-file-upload#storage_stream_file_upload-nodejs
  // Create a pass through stream from a string
  const passthroughStream = new Stream.PassThrough();
  passthroughStream.write(data)
  passthroughStream.end()

  async function streamFileUpload() {
    return new Promise((res, rej) => {
      passthroughStream.pipe(file.createWriteStream()).on('finish', () => {
        // The file upload is complete
        console.log(`${filename} uploaded to bucket`)
        res('')
      }).on('error', err => {
        console.error('Error writing file', filename, err)
        rej(err)
      })
    })
  }

  try {
    await streamFileUpload()
    console.log('streamFileUpload done')
  } catch(e) { console.error(e) };
}

async function tmpDownloadFile(file: File, tmpFilename: string) {
  await file.download({ destination: tmpFilename })
}

export async function concatTTSPieces(concats: string[], finalFile: string) {
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
