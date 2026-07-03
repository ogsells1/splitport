/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // @metamask/sdk pulls in an optional React Native storage dep that isn't
    // used on the web; alias it to false to silence the build-time warning.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};

module.exports = nextConfig;
