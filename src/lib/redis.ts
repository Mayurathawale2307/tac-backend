import Redis from "ioredis"
import { env } from "../config/env"

// Resilient Redis client initialization
let redis: Redis | null = null
let isRedisConnected = false

if (env.redisUrl) {
  try {
    redis = new Redis(env.redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        // Retry connection up to 3 times, then stop to prevent excessive logging
        if (times > 3) {
          console.warn("[Redis] Failed to connect after 3 attempts. Disabling Redis caching.")
          return null
        }
        return Math.min(times * 100, 2000)
      },
    })

    redis.on("connect", () => {
      isRedisConnected = true
      console.log("[Redis] Connected successfully.")
    })

    redis.on("error", (error) => {
      isRedisConnected = false
      console.error("[Redis] Connection error:", error.message)
    })
  } catch (error) {
    console.error("[Redis] Failed to initialize client:", error)
  }
} else {
  console.log("[Redis] REDIS_URL not configured. Redis caching is disabled.")
}

// In-memory request collapsing Map to prevent cache stampedes
const pendingRequests = new Map<string, Promise<any>>()

/**
 * Standardized caching wrapper. Gets key from Redis or runs fetchFn to load it from DB,
 * populates the cache with a TTL, and handles collapsing duplicate concurrent hits.
 */
export async function getCachedOrFetch<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>
): Promise<T> {
  // If Redis is disabled/offline, immediately fallback to database fetch
  if (!redis || !isRedisConnected) {
    return fetchFn()
  }

  // 1. Try to read from cache
  try {
    const cachedData = await redis.get(key)
    if (cachedData !== null) {
      return JSON.parse(cachedData) as T
    }
  } catch (error) {
    console.error(`[Redis] Read error on key "${key}":`, error)
  }

  // 2. Cache Miss: Collapse duplicate concurrent database requests
  let pendingPromise = pendingRequests.get(key)
  if (!pendingPromise) {
    pendingPromise = fetchFn().finally(() => {
      pendingRequests.delete(key)
    })
    pendingRequests.set(key, pendingPromise)
  }

  const freshData = await pendingPromise

  // 3. Write background update to cache
  if (freshData !== undefined && freshData !== null) {
    try {
      await redis.set(key, JSON.stringify(freshData), "EX", ttlSeconds)
    } catch (error) {
      console.error(`[Redis] Write error on key "${key}":`, error)
    }
  }

  return freshData
}

/**
 * General low-level caching interface
 */
export const cache = {
  async get<T>(key: string): Promise<T | null> {
    if (!redis || !isRedisConnected) return null
    try {
      const data = await redis.get(key)
      return data ? JSON.parse(data) : null
    } catch {
      return null
    }
  },

  async set(key: string, value: any, ttlSeconds: number): Promise<void> {
    if (!redis || !isRedisConnected) return
    try {
      await redis.set(key, JSON.stringify(value), "EX", ttlSeconds)
    } catch (error) {
      console.error(`[Redis] Set error for key "${key}":`, error)
    }
  },

  async del(key: string): Promise<void> {
    if (!redis || !isRedisConnected) return
    try {
      await redis.del(key)
    } catch (error) {
      console.error(`[Redis] Delete error for key "${key}":`, error)
    }
  },
}

/**
 * Active cache invalidation for User resources.
 * Evicts profile, team lists, api keys list, notifications, unread counts, etc.
 */
export async function invalidateUserCache(userId: string): Promise<void> {
  if (!redis || !isRedisConnected) return

  const keys = [
    `user:profile:${userId}`,
    `user:teams:${userId}`,
    `user:apikeys:${userId}`,
    `user:invites:${userId}`,
    `user:notifications:${userId}`,
    `user:notifications:unread_count:${userId}`,
    `user:feeds:${userId}`,
    `user:operations:${userId}`,
  ]

  try {
    await redis.del(...keys)
  } catch (error) {
    console.error(`[Redis] Invalidate User Cache error for user ${userId}:`, error)
  }
}

/**
 * Active cache invalidation for Team resources.
 * Evicts team details, notifications, and all paginated message log lists.
 */
export async function invalidateTeamCache(teamId: string): Promise<void> {
  if (!redis || !isRedisConnected) return

  try {
    // Delete base key metrics
    await redis.del(`team:details:${teamId}`)
    await redis.del(`team:notifications:${teamId}`)
    await redis.del(`team:messages:${teamId}:count`)

    // Scan & Delete paginated keys
    let cursor = "0"
    const pattern = `team:messages:${teamId}:*`
    
    do {
      const reply = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100)
      cursor = reply[0]
      const keys = reply[1]

      if (keys.length > 0) {
        await redis.del(...keys)
      }
    } while (cursor !== "0")
  } catch (error) {
    console.error(`[Redis] Invalidate Team Cache error for team ${teamId}:`, error)
  }
}

/**
 * Active cache invalidation for API Key hash.
 */
export async function invalidateApiKeyCache(keyHash: string): Promise<void> {
  if (!redis || !isRedisConnected) return

  try {
    await redis.del(`apikey:hash:${keyHash}`)
  } catch (error) {
    console.error(`[Redis] Invalidate API Key Cache error for hash ${keyHash}:`, error)
  }
}
