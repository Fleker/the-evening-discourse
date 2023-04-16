import { initializeApp, applicationDefault, cert, ServiceAccount } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import serviceAccount from '../functions/src/firebase'
import {Posts} from '../functions/src/posts'
initializeApp({
  credential: cert(serviceAccount as ServiceAccount)
});

const db = getFirestore();

// interface Podcast 

export async function getGeneratedPosts(username: string) {
  console.log('Get generated posts for', username)
  const posts = await db.collection('posts').where('username', '==', username).get()
  return posts.docs.map(d => d.data()) as Posts[]
}

export async function saveGeneratedPost(post: Posts) {
  await db.collection('posts').doc(`${post.username}-${post.bookmarkId}`).set(post)
}
