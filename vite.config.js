export default {
  server: { host: true }, // lets you open the dev site from your phone on the same Wi-Fi
  preview: { host: true },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: { manualChunks: { three: ['three'] } }, // three.js in its own file, cached separately
    },
  },
}
