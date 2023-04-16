import {getGeneratedPosts, saveGeneratedPost} from './firestore'
import { concatTTSPieces, generateStdTTSPiece, generateTTSPiece, storeInCloud, textToArray } from './cloud-tts'
import { authenticate, getArticlesData, getListOfArticles } from '../functions/src/instapaper-client'
import * as user from '../functions/src/nickfelker';
const cheerio = require('cheerio');
import * as fs from 'fs';
import * as os from 'os'
import * as path from 'path'
const { getAudioDurationInSeconds } = require('get-audio-duration');

(async () => {
  const {user_id} = (await authenticate(user.username, user.password))[0]
  const articles = await getArticlesData()
  const generatedPosts = await getGeneratedPosts(user_id.toString())
  const articleRequeue = []
  console.log(`Found ${articles.length} articles, ${generatedPosts.length} already processed`)
  for await (const a of articles) {
    // const a = articles[0]
    if (generatedPosts.find(p => p.bookmarkId === a.bookmark_id.toString())) {
      console.log(`Post ${a.title} already generated`)
      continue
    }
    // const content = htmlToSsml(a.content)
    const $ = cheerio.load(a.content)
    const contentArray = textToArray(a, $.text())
    try {
      // await generateTTS(ssml, `${a.bookmark_id}.mp3`)
      // await generateTTSLong(content, `${user.username}-${a.bookmark_id}`)
      console.log(contentArray)
      const concats = []
      for (let i = 0; i < contentArray.length; i++) {
        const text = contentArray[i]
        console.log('generate for', text.length)
        const filename = `${user_id}-${a.bookmark_id}-${i}`
        await generateTTSPiece(text, filename)
        concats.push(path.join(os.tmpdir(), `${filename}.mp3`))
      }
      const finalName = `${user_id}-${a.bookmark_id}.mp3`
      await concatTTSPieces(concats, `${finalName}`)
      console.log('TTS Generation done... save post')
      const buffer = fs.readFileSync(path.join(os.tmpdir(), finalName))
      const stats = fs.statSync(path.join(os.tmpdir(), finalName))
      const duration = await getAudioDurationInSeconds(path.join(os.tmpdir(), finalName))
      await storeInCloud(finalName, buffer)
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
      console.log('gt', e.message)
      if (e.message.includes('sentences that are too long')) {
        // RE-queue
        articleRequeue.push(a)
      }
      // Whelp this one failed but we'll get the next
      continue
    }
  }

  // Mostly a copy
  for await (const a of articleRequeue) {
    // const a = articles[0]
    if (generatedPosts.find(p => p.bookmarkId === a.bookmark_id.toString())) {
      console.log(`Post ${a.title} already generated`)
      continue
    }
    // const content = htmlToSsml(a.content)
    const $ = cheerio.load(a.content)
    const contentArray = textToArray(a, $.text())
    try {
      // await generateTTS(ssml, `${a.bookmark_id}.mp3`)
      // await generateTTSLong(content, `${user.username}-${a.bookmark_id}`)
      console.log(contentArray)
      const concats = []
      for (let i = 0; i < contentArray.length; i++) {
        const text = contentArray[i]
        console.log('std generate for', text.length)
        const filename = `${user_id}-${a.bookmark_id}-${i}`
        await generateStdTTSPiece(text, filename)
        concats.push(path.join(os.tmpdir(), `${filename}.mp3`))
      }
      const finalName = `${user_id}-${a.bookmark_id}.mp3`
      await concatTTSPieces(concats, `${finalName}`)
      console.log('std TTS Generation done... save post')
      const buffer = fs.readFileSync(path.join(os.tmpdir(), finalName))
      const stats = fs.statSync(path.join(os.tmpdir(), finalName))
      const duration = await getAudioDurationInSeconds(path.join(os.tmpdir(), finalName))
      await storeInCloud(finalName, buffer)
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
      console.log('sgt', e.message)
      // Whelp this one failed but we'll get the next
      continue
    }
  }
})()
