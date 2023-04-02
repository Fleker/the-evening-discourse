import {getGeneratedPosts, saveGeneratedPost} from './firestore'
import { convertToMp3, generateTTS, htmlToSsml } from './cloud-tts'
import { authenticate, getArticlesData, getListOfArticles } from './instapaper-client'
import * as user from './nickfelker';
const cheerio = require('cheerio');

(async () => {
  const {user_id} = (await authenticate(user.username, user.password))[0]
  const articles = await getArticlesData()
  const generatedPosts = await getGeneratedPosts(user_id)
  console.log(`Found ${articles.length} articles, ${generatedPosts.length} already processed`)
  // for await (const a of articles) {
    const a = articles[0]
    if (generatedPosts.find(p => p.bookmarkId === a.bookmark_id.toString())) {
      console.log(`Post ${a.title} already generated`)
      // continue
      return
    }
    // const content = htmlToSsml(a.content)
    const $ = cheerio.load(a.content)
    // console.log($.text())
    const content = `${a.title}. ${$.text()}. End of article. Thanks for reading.`
    // const ssml = `<speak>${a.title}<break time="1s"/>${content}</speak>`
    try {
      // await generateTTS(ssml, `${a.bookmark_id}.mp3`)
      // await generateTTS(content, `${user.username}-${a.bookmark_id}`)
      await generateTTS('Hello world', `${user_id}-${a.bookmark_id}`)
      console.log('TTS Generation done... save post')
      await convertToMp3([`${user_id}-${a.bookmark_id}.wav`])
      await saveGeneratedPost({
        title: a.title,
        bookmarkId: a.bookmark_id.toString(),
        username: user_id,
        timestamp: Date.now(),
        url: a.url,
      })
    } catch (e) {
      console.log(a.bookmark_id, a.title)
      // console.log(content)
      console.log('gt', e)
      // throw e
    }
  // }
})()
