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
  const ipIcon = `https://staticinstapaper.s3.dualstack.us-west-2.amazonaws.com/img/favicon.png?v=3a43e0f358075f9c79f8e1c10d6e737a`
  const feed: PodcastFeed2 = {
    icon: ipIcon,
    lastBuildDate: new Date(),
    link: 'https://instapaper.com',
    title: 'The Evening Discourse',
    itunesAuthor: 'Instapaper via TED',
    itunesImage: ipIcon,
    author: 'Instapaper via TED',
    itunesExplicit: false,
    itunesOwner: {
      email: 'handnf@gmail.com', // FIXME
      name: 'Nick Felker',
    },
    itunesCategory: {'News': ['Politics', 'News Commentary']},
    language: 'en-us',
    entries: posts.map(p => ({
      authors: 'TED',
      audio: {
        url: `https://storage.googleapis.com/evening-discourse.appspot.com/${p.bookmarkId}.mp3`,
        bytes: 1000, // FIXME
        format: 'audio/mpeg'
      },
      description: `${p.title}\n\n${p.url}`,
      // itunesSummary: epi.description,
      title: p.title,
      pubDate: new Date(p.timestamp),
      guid: p.bookmarkId,
      itunesDuration: 1, // FIXME
      itunesImage: ipIcon,
      link: p.url,
      itunesAuthor: 'Instapaper via TED',
      itunesExplicit: false,
    })),
  }
  res.setHeader('content-type', 'application/xml')
  res.status(200).send(toRss(feed))
})
