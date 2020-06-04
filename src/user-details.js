const Apify = require('apify');
const { QUERY_IDS } = require('./query_ids');
console.log(require.resolve('./helpers'))
const helpers = require('./helpers');
console.log('helpers')
console.dir(helpers)
const { log, singleQuery } = helpers;

const { postQueryId } = QUERY_IDS;

const users = {};

async function expandOwnerDetails(posts, page, itemSpec) {
    log(itemSpec, `Owner details - Expanding details for ${posts.length} items.`);
    const defaultVariables = { child_comment_count: 3, fetch_comment_count: 40, parent_comment_count: 24, has_threaded_comments: true };
    const transformFunction = (data) => {
        return data.shortcode_media.owner;
    };
    const transformedPosts = [];
    for (let i = 0; i < posts.length; i++) {
        log(itemSpec, `Owner details - Expanding owner details of post ${i+1}/${posts.length}`);
        if (!posts[i].ownerId) {
            transformedPosts.push(posts[i]);
            continue;
        }
        const newPost = { ...posts[i] };
        if (users[posts[i].ownerId]) {
            newPost.ownerUsername = users[posts[i].ownerId].username;
            newPost.owner = users[posts[i].ownerId];
            transformedPosts.push(newPost);
            continue;
        }
        const owner = await singleQuery(
            postQueryId,
            { shortcode: posts[i]['#debug'].shortcode, ...defaultVariables },
            transformFunction,
            page,
            itemSpec,
            'Owner details',
        );
        users[posts[i].ownerId] = owner;
        newPost.ownerUsername = users[posts[i].ownerId].username;
        newPost.owner = users[posts[i].ownerId];
        transformedPosts.push(newPost);
        await Apify.utils.sleep(500);
    }
    log(itemSpec, `Owner details - Details for ${posts.length} items expanded.`);
    return transformedPosts;
}

module.exports = {
    expandOwnerDetails,
};
