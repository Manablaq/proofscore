/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.resolve.fallback = { fs: false, net: false, tls: false }
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': require.resolve('./lib/async-storage-mock.js'),
    }
    return config
  },
}
module.exports = nextConfig
