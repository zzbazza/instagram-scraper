const { SCRAPE_TYPES } = require('./consts');

module.exports = {
    unsupportedPage: () => new Error('This instagram page is not supported.'),
    proxyIsRequired: () => new Error('Proxy is required to run this actor'),
    urlsAreRequired: () => new Error('Please provide urls configuration'),
    typeIsRequired: () => new Error('Type of scrape is required for the actor to run.'),
    unsupportedType: (type) => new Error(`Type "${type}" is not supported. Allowed types are "${Object.values(SCRAPE_TYPES).join('", "')}"`),
    notPostPage: () => new Error('Comments can only be loaded from posts detail page.'),
}