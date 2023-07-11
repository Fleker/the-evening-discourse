import { Component, OnInit } from '@angular/core';
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, Auth, signInWithPopup, User, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, onSnapshot, Firestore, updateDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDNB5xg5dturgy5EEolPe57-kRyM7xRPIY",
  authDomain: "evening-discourse.firebaseapp.com",
  projectId: "evening-discourse",
  storageBucket: "evening-discourse.appspot.com",
  messagingSenderId: "4250095023",
  appId: "1:4250095023:web:90a867f33959666bfdb35a",
  measurementId: "G-4MCLGQMGWV"
};

type BudgetType = 'bytes' | 'cost' | 'minutes' | 'posts'

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  title = 'evening-discourse';
  user?: User
  auth?: Auth
  db?: Firestore
  budget: Record<BudgetType, number|undefined> = {
    posts: undefined,
    bytes: undefined,
    cost: undefined,
    minutes: undefined,
  }
  connectedServices: string[] = []
  unconnectedServices: string[] = []
  readonly SERVICES = ['Instapaper']
  currentMonth: Record<BudgetType, number|undefined> = {
    posts: undefined,
    bytes: undefined,
    cost: undefined,
    minutes: undefined,
  }
  billingHistory: [string, Record<BudgetType, number|undefined>][] = []

  get podcastUrl() {
    if (this.user) {
      /// TODO: Add password
      return `https://us-central1-evening-discourse.cloudfunctions.net/podcast?user_id=${this.user.uid}`
    }
    return '#'
  }

  ngOnInit() {
    const app = initializeApp(firebaseConfig);
    this.auth = getAuth(app);
    this.db = getFirestore(app);
    onAuthStateChanged(this.auth, (user) => {
      if (user) {
        this.user = user
        this.listenDb()
      } else {
        this.user = undefined
      }
    });
  }

  async doAuth() {
    const provider = new GoogleAuthProvider();
    const res = await signInWithPopup(this.auth!, provider)
    this.user = res.user
    this.listenDb()
  }

  async listenDb() {
    // const observer = onSnapshot(doc(this.db!, 'users', this.user!.uid), (doc) => {
    const observer = onSnapshot(doc(this.db!, 'users', '5570887'), (doc) => {
      const data = doc.data() as any
      this.connectedServices = []
      this.unconnectedServices = []
      console.debug('user db', data)
      if (data.idInstapaper) {
        this.connectedServices.push('Instapaper')
      } else {
        this.unconnectedServices.push('Instapaper')
      }
      this.budget = {
        posts: data.budget.posts,
        minutes: data.budget.minutes,
        bytes: data.budget.bytes,
        cost: data.budget.cost,
      }
      this.currentMonth = data.currentMonth
    })

    onSnapshot(doc(this.db!, 'billing', '5570887'), (doc) => {
      const data = doc.data() as any
      this.billingHistory = Object.entries(data.history)
    })
  }

  async updateBudget() {
    // CxlIAS8vpLO9IXVv7Tjb157bgnj2
    window.requestAnimationFrame(async () => {
      const userRef = doc(this.db!, 'users', '5570887')
      const newBudget = {} as any
      if (this.budget.bytes) {
        newBudget.bytes = this.budget.bytes
      }
      if (this.budget.cost) {
        newBudget.cost = this.budget.cost
      }
      if (this.budget.minutes) {
        newBudget.minutes = this.budget.minutes
      }
      if (this.budget.posts) {
        newBudget.posts = this.budget.posts
      }
      await updateDoc(userRef, {
        budget: newBudget
      })
    })
  }
}
