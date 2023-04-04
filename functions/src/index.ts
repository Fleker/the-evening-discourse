// The Cloud Functions for Firebase SDK to create Cloud Functions and set up triggers.
import * as functions from 'firebase-functions'
import { initializeApp, } from 'firebase-admin/app';
import { getFirestore} from 'firebase-admin/firestore';

import { RssFeed, toRss} from '@fleker/standard-feeds'
import { ITunesCategory, ITunesSubcategory } from '@fleker/standard-feeds/src/rss';

initializeApp();
const db = getFirestore();

interface Posts {
  // Key: username-bookmark_id
  title: string
  bookmarkId: string
  username: string
  timestamp: number
  url: string
  fileSize: number
  audioLength: number
  description: string
}

export async function getGeneratedPosts(username: string) {
  console.log('Get generated posts for', username)
  const posts = await db.collection('posts').where('username', '==', username).get()
  return posts.docs.map(d => d.data()) as Posts[]
}

export interface PodcastFeed2 extends RssFeed {
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
