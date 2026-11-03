// Netlify entry point for the whole backend (backend/src). Netlify builds this automatically on every deploy.
// Data is kept in Netlify Blobs (no setup). Secrets come from Netlify > Site configuration > Environment variables.
import { getApp } from '../../backend/src/app.js'

export default async (req) => (await getApp()).handle(req)

export const config = { path: '/api/*' }
