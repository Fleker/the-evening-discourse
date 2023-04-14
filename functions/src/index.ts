import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'
// Initialize Firebase
admin.initializeApp(functions.config().firebase);
// const storage = admin.storage().bucket()
const db = admin.firestore()
const bucket = admin.storage().bucket('evening-discourse')

import { RssFeed, toRss} from '@fleker/standard-feeds'
import { ITunesCategory, ITunesSubcategory } from '@fleker/standard-feeds/src/rss';
import { authenticate, getArticlesData } from './instapaper-client'
import * as user from './nickfelker';
const cheerio = require('cheerio');
import * as fs from 'fs';
import { Posts } from './posts';
import { generateTTSPiece, textToArray } from './cloud-tts';
const { getAudioDurationInSeconds } = require('get-audio-duration');
import textToSpeech from '@google-cloud/text-to-speech'
import { google } from '@google-cloud/text-to-speech/build/protos/protos';
import * as ffmpeg from 'fluent-ffmpeg'
import {Stream} from 'stream'
import {File, Bucket} from '@google-cloud/storage'
import { Article } from './instapaper-client';
import * as os from 'os'
import * as path from 'path'

async function getGeneratedPosts(username: string) {
  console.log('Get generated posts for', username)
  const posts = await db.collection('posts').where('username', '==', username).get()
  return posts.docs.map(d => d.data()) as Posts[]
}

async function saveGeneratedPost(post: Posts) {
  await db.collection('posts').doc(`${post.username}-${post.bookmarkId}`).set(post)
}

interface PodcastFeed2 extends RssFeed {
  author: string
  language?: string
  itunesAuthor?: string
  itunesSubtitle?: string
  itunesOwner?: {
    name: string
    email: string
  }
  itunesExplicit?: boolean
  itunesCategory?: Partial<Record<ITunesCategory, ITunesSubcategory[]>>
  itunesImage?: string
}

async function convertInstapaperToMp3() {
  const {user_id} = (await authenticate(user.username, user.password))[0]
  const articles = await getArticlesData()
  const generatedPosts = await getGeneratedPosts(user_id.toString())
  console.log(`Found ${articles.length} articles, ${generatedPosts.length} already processed`)
  for await (const a of articles) {
    if (generatedPosts.find(p => p.bookmarkId === a.bookmark_id.toString())) {
      console.log(`Post ${a.title} already generated`)
      continue
    }

    const $ = cheerio.load(a.content)
    const contentArray = textToArray(a, $.text())
    
    try {
      // console.log(contentArray)
      const concats = []
      for (let i = 0; i < contentArray.length; i++) {
        const text = contentArray[i]
        console.log('generate for', text.length)
        const filename = `${user_id}-${a.bookmark_id}-${i}`
        await generateTTSPiece(text, filename)
        concats.push(`${filename}.mp3`)
      }
    
      const finalName = `${user_id}-${a.bookmark_id}.mp3`
      await concatTTSPieces(bucket, ['intro.wav', ...concats, 'ending.wav'], `${finalName}`)
      console.log('TTS Generation done... save post')
      const buffer = fs.readFileSync(finalName)
      const stats = fs.statSync(finalName)
      const duration = await getAudioDurationInSeconds(finalName)
      await storeInCloud(bucket, finalName, buffer)
      await saveGeneratedPost({
        title: a.title,
        bookmarkId: a.bookmark_id.toString(),
        username: user_id.toString(),
        timestamp: Date.now(),
        url: a.url,
        fileSize: stats.size,
        audioLength: duration,
        description: contentArray[0],
      })
    } catch (e) {
      console.log(a.bookmark_id, a.title)
      console.log('gt', e)
    }
  }
  // return Promise.resolve('0')
}

export const instapaperTts = functions/*.runWith({
  timeoutSeconds: 540,
  memory: '1GB',
})*/.pubsub.schedule('50 */1 * * *')
  .onRun(async () => {
    return await convertInstapaperToMp3();
});

export const podcast = functions.https.onRequest(async (req, res) => {
  const user_id = req.query.user_id as string
  // const pwd = req.query.pwd as string
  const posts = await getGeneratedPosts(user_id)
  if (!posts.length) {
    res.status(404).send('Podcast by this ID does not exist')
  }
  const ipIcon = `https://i.imgur.com/6ARxPBS.png`
  const feed: PodcastFeed2 = {
    icon: ipIcon,
    lastBuildDate: new Date(),
    link: 'https://instapaper.com',
    title: 'Your Evening Discourse',
    itunesAuthor: 'The Evening Discourse',
    itunesImage: ipIcon,
    author: 'The Evening Discourse',
    itunesExplicit: false,
    itunesOwner: {
      email: 'handnf@gmail.com', // FIXME
      name: 'Nick Felker',
    },
    itunesCategory: {'News': ['Politics', 'News Commentary']},
    language: 'en-us',
    entries: posts.map(p => ({
      authors: 'The Evening Discourse',
      audio: {
        url: `https://storage.googleapis.com/evening-discourse/${p.username}-${p.bookmarkId}.mp3`,
        bytes: p.fileSize,
        format: 'audio/mpeg'
      },
      description: `${p.description ?? ''}\n\n${p.url}`,
      // itunesSummary: epi.description,
      title: p.title,
      pubDate: new Date(p.timestamp),
      guid: p.bookmarkId,
      itunesDuration: p.audioLength,
      itunesImage: ipIcon,
      link: p.url.replace(/[?&]/g, ''),
      itunesAuthor: 'The Evening Discourse',
      itunesExplicit: false,
    })),
  }
  res.setHeader('content-type', 'application/xml')
  res.status(200).send(toRss(feed))
})

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

  async function storeInCloud(bucket: Bucket, filename: string, data: Buffer) {
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