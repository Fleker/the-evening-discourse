import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'
// Initialize Firebase
admin.initializeApp(functions.config().firebase);
// const storage = admin.storage().bucket()
const db = admin.firestore()
const bucket = admin.storage().bucket('evening-discourse')

import { RssFeed, toRss} from '@fleker/standard-feeds'
import { ITunesCategory, ITunesSubcategory } from '@fleker/standard-feeds/src/rss';
import { authenticate, getArticlesData, Article } from './instapaper-client'
const cheerio = require('cheerio');
import * as fs from 'fs';
import { Generations, InstapaperSync, Posts, Bill, User } from './posts';
import { generateTTSPiece, textToArray } from './cloud-tts';
const { getAudioDurationInSeconds } = require('get-audio-duration');
import * as ffmpeg from 'fluent-ffmpeg'
import {Stream} from 'stream'
import {File, Bucket} from '@google-cloud/storage'
import * as os from 'os'
import * as path from 'path'
import { FieldValue } from 'firebase-admin/firestore';

// I need a way to sync IP archivals
async function getGeneratedPosts(username: string) {
  const oneMonthAgo = Date.now() - 1000 * 60 * 60 * 24 * 31
  console.log('Get generated posts for', username)
  const posts = await db.collection('posts')
    .where('username', '==', username)
    .where('timestamp', '>', oneMonthAgo)
    .orderBy('timestamp', 'desc')
    .limit(100)
    .get()
  return posts.docs.map(d => d.data()) as Posts[]
}

async function getExistingIPArticles(username: string): Promise<InstapaperSync | undefined> {
  const posts = await db.collection('syncInstapaper')
    .doc(username) // TODO: Make this the UID at some point
    .get()
  return posts.exists ? posts.data() as InstapaperSync : undefined
}

async function getExistingTTS(url: string): Promise<Generations | undefined> {
  const sanitizedUrl = url
    .replace(/https:\/\//g, '')
    .replace(/\//g, '_')
  const posts = await db.collection('generated')
    .doc(sanitizedUrl)
    .get()
  return posts.exists ? posts.data() as Generations : undefined
}

async function addExistingTTS(url: string, data: Generations): Promise<boolean> {
  const sanitizedUrl = url
    .replace(/https:\/\//g, '')
    .replace(/\//g, '_')
  await db.collection('generated')
    .doc(sanitizedUrl)
    .set(data)
  return Promise.resolve(true)
}

async function saveGeneratedPost(post: Posts) {
  await db.collection('posts').doc(`${post.username}-${post.bookmarkId}`).set(post)
}

function calculateCost(contentSize: number, fileSize: number) {
  // See https://cloud.google.com/text-to-speech/pricing
  const neural2 = 0.000016
  const std = 0.000004
  // https://cloud.google.com/storage/pricing
  const hosting = 0.00000000002 // $/B/month
  const download = 0.00000000012 // Download/B
  const serviceSurcharge = 0.05 // To support further development (~$1 at one article/weekday)
  return (neural2 + std) * contentSize // In case we have to downgrade
    + (hosting * 12 * fileSize) // A year of hosting
    + (download * 2 * fileSize) // Upload & download
    + serviceSurcharge
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

function getVoicesFor(article: Article) {
  if (article.title.startsWith('Money Stuff:')) {
    // Male-voice
    return [
      'en-US-Neural2-A', 'en-US-Standard-D',
    ]
  }

  // Default
  return [
    'en-US-Neural2-F', 'en-US-Standard-G',
  ]
}

async function generateArrayOfTts(voice: string, fileprefix: string, contentArray: string[]) {
  const concats = []
  for (let i = 0; i < contentArray.length; i++) {
    const text = contentArray[i]
    console.log('generate for', text.length)
    const filename = `${fileprefix}-${i}`
    await generateTTSPiece(voice, text, filename)
    concats.push(path.join(os.tmpdir(), `${filename}.mp3`))
  }
  return concats
}

async function fetchInstapaperPassword(uid: string, idInstapaper: string) {
  const pwd = await db.collection('authInstapaper').doc(idInstapaper).get()
  if (!pwd.exists) {
    throw new Error(`No Instapaper account for ${uid}`)
  }
  const {password} = pwd.data()
  return {
    username: idInstapaper,
    password,
  }
}

async function convertInstapaperToMp3(uid: string, idInstapaper: string, userRef: FirebaseFirestore.DocumentReference) {
  const {username, password} = await fetchInstapaperPassword(uid, idInstapaper)
  const {user_id} = await authenticate(username, password)
  const articles = await getArticlesData()
  const generatedPosts = await getExistingIPArticles(user_id.toString()) ?? { posts: {} }
  console.log(`Found ${articles.length} articles, ${generatedPosts.posts.length} already processed`)

  const deprecated = await getGeneratedPosts(user_id.toString())
  console.log(`Found ${articles.length} articles, ${deprecated.length} already processed`)
  const articlePromises = []
  for (const a of articles) {
    articlePromises.push(new Promise(async (res, rej) => {
      if (Object.keys(generatedPosts.posts).includes(a.bookmark_id.toString())) {
        console.log(`Post ${a.title} already generated`)
        return res('1');
      }
  
      // FIXME later
      if (deprecated.find(p => p.bookmarkId === a.bookmark_id.toString())) {
        console.log(`Post ${a.title} already generated`)
        return res('1');
      }
  
      const hasGenerated = await getExistingTTS(a.url)
      if (hasGenerated) {
        // Short-circuit. No need to regen.
        console.log(`Short-circuit. Recycling TTS for ${a.title}`)
        await saveGeneratedPost({
          title: a.title,
          bookmarkId: a.bookmark_id.toString(),
          username: user_id.toString(),
          timestamp: Date.now(),
          url: a.url,
          fileSize: hasGenerated.fileSize,
          audioLength: hasGenerated.audioLength,
          description: hasGenerated.description,
          filepath: hasGenerated.cloudStorageTts
        })
  
        // Update /billing
        const date = new Date()
        const dateKey = `${(date.getMonth() + 1).toString()}-${date.getFullYear()}`
        const billingAccount = await db.collection('billing').doc(user_id.toString()).get()
        const ttsCost = calculateCost(a.content.length, hasGenerated.fileSize)
        if (billingAccount.exists) {
          await billingAccount.ref.update({
            [`history.${dateKey}.minutes`]: FieldValue.increment(hasGenerated.audioLength / 60),
            [`history.${dateKey}.bytes`]: FieldValue.increment(a.content.length),
            [`history.${dateKey}.posts`]: FieldValue.increment(1),
            [`history.${dateKey}.fileBytes`]: FieldValue.increment(hasGenerated.fileSize),
            [`history.${dateKey}.cost`]: FieldValue.increment(ttsCost),
          })
        } else {
          await billingAccount.ref.set({
            history: {
              [dateKey]: {
                minutes: hasGenerated.audioLength / 60,
                bytes: a.content.length,
                posts: 1,
                fileBytes: hasGenerated.fileSize,
                cost: calculateCost(a.content.length, hasGenerated.fileSize),
              } as Bill
            }
          })
        }
        // Update current month for /user
        console.log(`Update userRef.currentMonth`)
        await userRef.update({
          [`currentMonth.minutes`]: FieldValue.increment(hasGenerated.audioLength / 60),
          [`currentMonth.bytes`]: FieldValue.increment(a.content.length),
          [`currentMonth.posts`]: FieldValue.increment(1),
          [`currentMonth.fileBytes`]: FieldValue.increment(hasGenerated.fileSize),
          [`currentMonth.cost`]: FieldValue.increment(ttsCost),
        })
        return res('1');
      }
  
      const $ = cheerio.load(a.content)
      const contentArray = textToArray(a, $.text())
      const voices = getVoicesFor(a)
      const fileprefix = `${user_id}-${a.bookmark_id}`
      let concats: string[] = []
  
      while (true) {
        const voice = voices.shift()
        if (!voice) {
          console.error('Ran out of voices for article', a.title)
          break;
        }
        try {
          concats = await generateArrayOfTts(voice, fileprefix, contentArray)
          break; // Break if successful
        } catch (e) {
          console.error('TTS Error', e)
          // We did not succeed on the first voice.
          // Try the next voice and loop.
          // ie. "sentences that are too long"
        }
      }
      
      try {
        const finalName = `${fileprefix}.mp3`
        await concatTTSPieces(bucket, [...concats], `${finalName}`)
        console.log('TTS Generation done... save post')
  
        const finalFile = path.join(os.tmpdir(), finalName)
  
        const buffer = fs.readFileSync(finalFile)
        const stats = fs.statSync(finalFile)
        const duration = await getAudioDurationInSeconds(finalFile)
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
          filepath: finalName,
        })
  
        // Normalize DB ops
        // Update /syncInstapaper
        const ipPosts = await db.collection('syncInstapaper')
          .doc(user_id.toString()) // TODO: Make this the UID at some point
          .get()
        if (ipPosts.exists) {
          // Eventually we'll need to prune this
          await ipPosts.ref.update({
            [`posts.${a.bookmark_id.toString()}`]: Date.now(),
          })
        } else {
          await ipPosts.ref.set({
            posts: {
              [a.bookmark_id.toString()]: Date.now(),
            }
          })
        }
  
        // Update /generated
        await addExistingTTS(a.url, {
          cloudStorageTts: finalName,
          fileSize: stats.size,
          audioLength: duration,
          description: contentArray[0],
        })
  
        // Update /billing
        const date = new Date()
        const dateKey = `${(date.getMonth() + 1).toString()}-${date.getFullYear()}`
        const billingAccount = await db.collection('billing').doc(user_id.toString()).get()
        const ttsCost = calculateCost(a.content.length, stats.size)
        if (billingAccount.exists) {
          console.log(`Update billing for ${user_id}: ${calculateCost(a.content.length, stats.size)}`)
          await billingAccount.ref.update({
            [`history.${dateKey}.minutes`]: FieldValue.increment(duration / 60),
            [`history.${dateKey}.bytes`]: FieldValue.increment(a.content.length),
            [`history.${dateKey}.posts`]: FieldValue.increment(1),
            [`history.${dateKey}.fileBytes`]: FieldValue.increment(stats.size),
            [`history.${dateKey}.cost`]: FieldValue.increment(ttsCost),
          })
        } else {
          console.warn(`User ${user_id} has no billing account`)
          await billingAccount.ref.set({
            history: {
              [dateKey]: {
                minutes: duration / 60,
                bytes: a.content.length,
                posts: 1,
                fileBytes: stats.size,
                cost: calculateCost(a.content.length, stats.size),
              } as Bill
            }
          })
        }
  
        // Update current month for /user
        console.log(`Update userRef.currentMonth`)
        await userRef.update({
          [`currentMonth.minutes`]: FieldValue.increment(duration / 60),
          [`currentMonth.bytes`]: FieldValue.increment(a.content.length),
          [`currentMonth.posts`]: FieldValue.increment(1),
          [`currentMonth.fileBytes`]: FieldValue.increment(stats.size),
          [`currentMonth.cost`]: FieldValue.increment(ttsCost),
        })
      } catch (e) {
        console.error(a.bookmark_id, a.title)
        console.error('Mix Error', e)
      }

      return res('2');
    }))
  }
  return Promise.allSettled(articlePromises)
}

type IterativeCallback = (id: string, user: User, ref: FirebaseFirestore.DocumentReference) => void

/**
 * Run a set of behavior on all users in an iterative approach.
 * This cuts down on in-memory at any given time, as only 300 are acted upon.
 *
 * @param callback Logic to run on a subset of users
 */
export async function forEveryUser(callback: IterativeCallback) {
  const LIMIT = 150
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>
  while (true) {
    const query = (() => {
      let q = db.collection('users') as any
      if (lastDoc!) {
        console.log('New iteration: start after', lastDoc!.id)
        return q
          .startAfter(lastDoc!)
          .limit(LIMIT)
      } else {
        return q
        .limit(LIMIT)
      }
    })()

    const querySnapshot = await query.get()
    // Update token
    lastDoc = querySnapshot.docs[querySnapshot.docs.length-1];

    for (let i = 0; i < querySnapshot.size; i++) {
      const doc = querySnapshot.docs[i]
      await callback(doc.id, doc.data() as User, doc.ref)
    }

    if (querySnapshot.docs.length < LIMIT) {
      break // Exit loop once we've iterated through everyone
    }
  }
}


export const instapaperTts = functions.runWith({
  timeoutSeconds: 540,
  memory: '1GB',
}).pubsub.schedule('50 */1 * * *')
  .onRun(async () => {
    return await forEveryUser(async (id, user, ref) => {
      if (user.budget.bytes && user.budget.bytes <= user.currentMonth.bytes) return
      if (user.budget.minutes && user.budget.minutes <= user.currentMonth.minutes) return
      if (user.budget.posts && user.budget.posts <= user.currentMonth.posts) return
      if (user.budget.cost && user.budget.cost <= user.currentMonth.cost) return
      if (user.idInstapaper) {
        try {
          await convertInstapaperToMp3(id, user.idInstapaper, ref);
        } catch (e) {
          console.error(e)
        }
      }
    })
    // const promises = []
    // forEveryUser(async (id, user, ref) => {
    //   if (user.budget.bytes && user.budget.bytes <= user.currentMonth.bytes) return 1
    //   if (user.budget.minutes && user.budget.minutes <= user.currentMonth.minutes) return 1
    //   if (user.budget.posts && user.budget.posts <= user.currentMonth.posts) return 1
    //   if (user.budget.cost && user.budget.cost <= user.currentMonth.cost) return 1
    //   if (user.idInstapaper) {
    //     try {
    //       promises.push(convertInstapaperToMp3(id, user.idInstapaper, ref))
    //     } catch (e) {
    //       console.error(e)
    //     }
    //   }
    //   return 0
    // })
    // await Promise.allSettled(promises)
});

interface SaveAuthRequest {
  type: 'instapaper'
  instapaper: {
    username: string
    password: string
  }
}

export const saveAuth = functions.https.onCall(async (data: SaveAuthRequest, context) => {
  switch (data.type) {
    case 'instapaper': {
      const {username, password} = data.instapaper
      const userRef = db.collection('users').doc(context.auth.uid)
      await userRef.update({
        idInstapaper: username
      })
      const ipRef = db.collection('authInstapaper').doc(username)
      await ipRef.update({
        password,
      })
      break
    }
    default: {
      throw new functions.https.HttpsError('not-found',
        `Cannot find service ${data.type}`)
    }
  }
})

export const podcast = functions.https.onRequest(async (req, res) => {
  const user_id = req.query.user_id as string
  // const pwd = req.query.pwd as string
  const posts = await getGeneratedPosts(user_id)
  if (!posts.length) {
    res.status(404).send('Podcast by this ID does not exist')
  }
  const ipIcon = `https://storage.googleapis.com/evening-discourse/evening-discourse-logo.png`
  const feed: PodcastFeed2 = {
    icon: ipIcon,
    lastBuildDate: new Date(),
    link: 'https://instapaper.com', // FIXME
    title: 'Your Evening Discourse',
    itunesAuthor: 'The Evening Discourse | Quillcast',
    itunesImage: ipIcon,
    author: 'The Evening Discourse | Quillcast',
    itunesExplicit: false,
    itunesOwner: {
      email: 'handnf+quillcast@gmail.com', // FIXME
      name: 'Nick Felker',
    },
    itunesCategory: {'News': ['Politics', 'News Commentary']},
    language: 'en-us',
    entries: posts.map(p => ({
      authors: 'The Evening Discourse',
      audio: {
        url: `https://storage.googleapis.com/evening-discourse/${p.filepath ?? `${p.username}-${p.bookmarkId}.mp3`}`,
        bytes: p.fileSize,
        format: 'audio/mpeg'
      },
      description: `${p.description ?? ''}\n\n${p.url}`,
      itunesSummary: `${p.url}`,
      title: p.title,
      pubDate: new Date(p.timestamp),
      guid: p.bookmarkId,
      itunesDuration: p.audioLength,
      itunesImage: ipIcon,
      link: p.url.replace(/[?&]/g, ''),
      itunesAuthor: 'The Evening Discourse | Quillcast',
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