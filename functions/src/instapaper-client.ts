import { CONSUMER_ID, CONSUMER_SECRET } from "./ip-api"

const Instapaper = require('instapaper-node-sdk')
const client = new Instapaper(CONSUMER_ID, CONSUMER_SECRET)

export interface Article {
  content: string
  bookmark_id: number
  url: string
  title: string
}

export async function authenticate(username: string, password: string) {
  client.setCredentials(username, password)
  const creds = await client.verifyCredentials()
  return creds[0]
}

export async function getListOfArticles() {
  return await client.list()
}

export async function getArticlesData(): Promise<Article[]> {
  const bookmarks = await getListOfArticles()
  const out = []
  // console.log(bookmarks)
  // let t = 0
  for await (const b of bookmarks) {
    if (b.type !== 'bookmark') continue
    // if (t > 0) continue
    // t = 1
    const {bookmark_id, url, title} = b
    console.log(bookmark_id, b.description, b)
    if (bookmark_id === undefined) continue
    if (!title) continue
    try {
      const content = await client.request('/bookmarks/get_text', { bookmark_id: `${bookmark_id}` }, '1.1')
      // console.log('content', content)
      out.push({
        content,
        bookmark_id,
        url,
        title,
      })
    } catch (e) {
      console.error(`error fetching "${title}": ${e}`)
    }
  }
  return out
}
