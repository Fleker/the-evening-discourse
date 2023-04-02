const { GoogleAuth } = require('google-auth-library');
import textToSpeech from '@google-cloud/text-to-speech'
import { google } from '@google-cloud/text-to-speech/build/protos/protos';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import type {
  Callback,
  CallOptions,
  Descriptors,
  ClientOptions,
  GrpcClientOptions,
  LROperation,
} from 'google-gax';
const credentials = require('../evening-discourse-8552cd83fb6f.json');
// Import other required libraries
import * as fs from 'fs';
const util = require('util');
import * as ffmpeg from 'fluent-ffmpeg'
import {Stream} from 'stream'
import {Bucket, File} from '@google-cloud/storage'
import { getStorage } from 'firebase-admin/storage'
const serviceAccount = require('../evening-discourse-firebase-adminsdk-d6yqz-2a9bfb7bcd.json');

const bucket = getStorage().bucket('evening-discourse')


export async function load() {
  // Create a new GoogleAuth client using the credentials JSON file
  const auth = new GoogleAuth({
    keyFilename: '/path/to/your/credentials.json',
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });

  // Get a new access token
  const accessToken = await auth.getAccessToken();

  // Create a new TextToSpeech client using the access token
}

const stdClient = new textToSpeech.TextToSpeechClient({
  credentials,
});

const client = new textToSpeech.TextToSpeechLongAudioSynthesizeClient({
  credentials,
});

async function delay(ms: number) {
  return new Promise<void>((res) => {
    setTimeout(() => {
      res()
    }, ms)
  })
}

async function waitForOp(response: LROperation<google.cloud.texttospeech.v1.ISynthesizeLongAudioResponse, google.cloud.texttospeech.v1.ISynthesizeLongAudioMetadata>) {
  return new Promise(async (res, rej) => {
    while (true) {
      console.log(response.name, response.done)
      try {
        const op = await response.getOperation()
        if (op[0] !== null) {
          rej(op[0])
        }
        if (op[1] === null) {
          await delay(1000)
          // Not done yet
        }
        if (op[1] !== null) {
          res(op[1])
          break
        }
      } catch (e) {
        console.error('Error', e)
        await delay(5000)
      }
    }
  })
}

export async function generateTTSPiece(ssml: string, outputFile: string) {
  // Construct the request
  const request: google.cloud.texttospeech.v1.ISynthesizeSpeechRequest = {
    input: {text: ssml}, // TODO
    // Select the language and SSML voice gender (optional)
    // voice: {languageCode: 'en-US', /*ssmlGender: 'FEMALE',*/ name: 'en-US-Neural-C'},
    voice: {languageCode: 'en-US', ssmlGender: 'FEMALE'},
    // select the type of audio encoding
    audioConfig: {audioEncoding: 'MP3'},
  };
  console.log(outputFile, request)

  // Performs the text-to-speech request
  // https://github.com/googleapis/gax-nodejs/blob/main/client-libraries.md#long-running-operations
  // But `Error when polling for synth completion Error: 3 INVALID_ARGUMENT: Request contains an invalid argument.`
  const [response] = await stdClient.synthesizeSpeech(request);
  // Write the binary audio content to a local file
  try {
    await fs.writeFileSync(`${outputFile}.mp3`, response.audioContent, 'binary');
    console.log('tts promise resolved')
  } catch (e) {
    // throw e
  }
  return 0
}

export async function generateTTSLong(text: string, outputFile: string) {
  // Construct the request
  const request: google.cloud.texttospeech.v1.ISynthesizeLongAudioRequest = {
    input: {text},
    // Select the language and SSML voice gender (optional)
    voice: {languageCode: 'en-US', name: 'en-US-Standard-A'},
    // select the type of audio encoding
    audioConfig: {audioEncoding: 'LINEAR16'},
    // audioConfig: {audioEncoding: 'MP3'},
    outputGcsUri: `gs://evening-discourse/${outputFile}.wav`
    // outputGcsUri: `gs://evening-discourse/${outputFile}.mp3`
  };
  console.log(request)

  // Performs the text-to-speech request
  // https://github.com/googleapis/gax-nodejs/blob/main/client-libraries.md#long-running-operations
  // But `Error when polling for synth completion Error: 3 INVALID_ARGUMENT: Request contains an invalid argument.`
  const [response] = await client.synthesizeLongAudio(request);
  console.log('got tts response_0')
  console.log(response.done, response.name, response.metadata, response.result)
  console.log('got tts response_1')
  // Write the binary audio content to a local file
  // const writeFile = util.promisify(fs.writeFile);
  // await writeFile(outputFile, response.audioContent, 'binary');
  // console.log('Audio content written to file: output.mp3');
  try {
    // await waitForOp(response)
    await response.promise()
    console.log('tts promise resolved')
  } catch (e) {
    console.error('Error when polling for synth completion', e)
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

export async function convertToMp3(outputFile: string[]) {
  const filename = outputFile[0] // TODO: Eventually support concat
  // gs://quillcast.appspot.com/episodes/arbjw1q99eWslVrW8siu-f0ba924e.wav
  const file = bucket.file(filename)

  async function tmpDownloadFile(file: File, tmpFilename: string) {
    await file.download({ destination: tmpFilename })
  }

  async function convertWavToMp3(filename: string) {
    const mp3 = filename.replace('.wav', '.mp3')
    return new Promise((res, rej) => {
      ffmpeg({
        source: filename,
      }).on("error", (err) => {
        rej(err);
      }).on("end", () => {
        res(mp3);
      }).save(mp3);
    });
  }

  const tmpFilename = `tmp-${filename}.wav`
  const mp3Filename = `tmp-${filename}.mp3`
  const cloudFilename = `${filename}.mp3`
  await tmpDownloadFile(file, tmpFilename)
  await convertWavToMp3(tmpFilename)
  const mp3File = fs.readFileSync(mp3Filename)
  await storeInCloud(cloudFilename, mp3File)
}

export function htmlToSsml(html: string) {
  return html
    .replace(/\t/g, '')
}

export function concatTTSPieces(concats: string[], finalFile: string) {
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
    .mergeToFile(finalFile)
    // Setting ID3 tags
    // .addOutputOption('-metadata', `title=${episode.title}`)
    // .addOutputOption('-metadata', `artist=${feed.author}`)
    // .addOutputOption('-metadata', `album=${feed.title}`)
  })
}