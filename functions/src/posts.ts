/** Firebase Collection /posts/{doc} */
export interface Posts {
  // Key: username-bookmark_id
  title: string
  bookmarkId: string
  username: string
  timestamp: number
  url: string
  fileSize: number
  audioLength: number
  description: string
  filepath?: string
}

/** Firebase Collection /syncInstapaper/{uid} */
export interface InstapaperSync {
  /** Post ID and timestamp */
  posts: Record<string, number>
}

/** Firebase Collection /authInstapaper/{instapaperId} */
export interface InstapaperAuth {
  password: string
}

/** Firebase Collection /users/{uid} */
export interface User {
  /** Instapaper ID */
  idInstapaper: string
  /** Monthly budget */
  budget: Partial<Bill>
  currentMonth: Bill
}

export interface Bill {
  minutes: number
  bytes: number
  posts: number
  fileBytes: number
  cost: number
}

/** Firebase Collection /billing/{uid} */
export interface Billing {
  /** Setup for each month */
  history: Record<string, Bill>
}

/** Firebase collection /generated/{url} */
export interface Generations {
  cloudStorageTts: string
  fileSize: number
  audioLength: number
  description: string
}
