import {getGeneratedPosts, saveGeneratedPost} from './firestore'
import { concatTTSPieces, convertToMp3, generateTTSLong, generateTTSPiece, htmlToSsml, storeInCloud } from './cloud-tts'
import { authenticate, getArticlesData, getListOfArticles } from './instapaper-client'
import * as user from './nickfelker';
const cheerio = require('cheerio');
import * as fs from 'fs';
const { getAudioDurationInSeconds } = require('get-audio-duration');

(async () => {
  const {user_id} = (await authenticate(user.username, user.password))[0]
  const articles = await getArticlesData()
  const generatedPosts = await getGeneratedPosts(user_id.toString())
  console.log(`Found ${articles.length} articles, ${generatedPosts.length} already processed`)
  for await (const a of articles) {
    // const a = articles[0]
    if (generatedPosts.find(p => p.bookmarkId === a.bookmark_id.toString())) {
      console.log(`Post ${a.title} already generated`)
      // continue
      return
    }
    // const content = htmlToSsml(a.content)
    const $ = cheerio.load(a.content)
    // console.log($.text())
    const text = $.text()
      .replace(/\t/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      // NYTimes
      .replace("Send any friend a storyAs a subscriber, you have 10 gift articles to give each month. Anyone can read what you share.", '')
    const content = `${text}. End of article. Thanks for reading.`
    // const ssml = `<speak>${a.title}<break time="1s"/>${$.}</speak>`
    const contentArray = (() => {
      const arr = [`${a.title}.`]
      let c = a.title.length
      const words = content.split(' ')
      for (const w of words) {
        if (c + w.length >= 5000 /* Max */) {
          arr.push(w)
          c = w.length + 2
        } else {
          arr[arr.length - 1] += ` ${w}`
          c += w.length + 2
        }
      }
      return arr
    })()
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
        concats.push(`${filename}.mp3`)
      }
      const finalName = `${user_id}-${a.bookmark_id}.mp3`
      await concatTTSPieces(concats, `${finalName}`)
      console.log('TTS Generation done... save post')
      const buffer = fs.readFileSync(finalName)
      const stats = fs.statSync(finalName)
      const duration = await getAudioDurationInSeconds(finalName)
      await storeInCloud(finalName, buffer)
      // await convertToMp3([`${user_id}-${a.bookmark_id}.wav`])
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
      // console.log(content)
      console.log('gt', e)
      // throw e
    }
  }
})()
