module.exports = {
    unsupportedPage: () => new Error('This instagram page is not supported.'),
    proxyIsRequired: () => new Error('Proxy is required to run this actor'),
    urlsAreRequired: () => new Error('Please provide urls configuration'),
}