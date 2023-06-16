import textToSpeech from '@google-cloud/text-to-speech'
import { google } from '@google-cloud/text-to-speech/build/protos/protos';
import * as fs from 'fs';
import * as ffmpeg from 'fluent-ffmpeg'
import {Stream} from 'stream'
import {File, Bucket} from '@google-cloud/storage'
import { Article } from './instapaper-client';
import * as os from 'os'
import * as path from 'path'

const stdClient = new textToSpeech.TextToSpeechClient();

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
    .replace(/CRISPR/g, 'crisper')
    .replace(/Colbert/g, 'coal bear')
    // Other fixes
    .replace(/Mr./g, 'Mister')
    .replace(/Ms./g, 'Miss')
    .replace(/Mrs./g, 'Missus')
    // Fix close-together punctuation
    // .replace(/([.?!"“”])(\w)/g, '$1 $2')
    // .replace(/(\w)([.?!"“”])/g, '$1 $2')
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

export async function generateTTSPiece(voice: string, ssml: string, outputFile: string) {
  // Construct the request
  const request: google.cloud.texttospeech.v1.ISynthesizeSpeechRequest = {
    input: {text: ssml}, // TODO
    // Select the language and SSML voice gender (optional)
    // voice: {languageCode: 'en-US', name: 'en-US-Studio-O'},
    voice: {languageCode: 'en-US', name: voice},
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
