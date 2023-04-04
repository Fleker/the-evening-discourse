import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
const serviceAccount = require('../evening-discourse-firebase-adminsdk-d6yqz-2a9bfb7bcd.json');

initializeApp({
  credential: cert(serviceAccount)
});

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

// interface Podcast 

export async function getGeneratedPosts(username: string) {
  console.log('Get generated posts for', username)
  const posts = await db.collection('posts').where('username', '==', username).get()
  return posts.docs.map(d => d.data()) as Posts[]
}

export async function saveGeneratedPost(post: Posts) {
  await db.collection('posts').doc(`${post.username}-${post.bookmarkId}`).set(post)
}
