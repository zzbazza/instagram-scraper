const { log, finiteQuery } = require('./helpers');

const likesQueryId = 'd5d763b1e2acf209d62d22d184488e57';

async function getPostLikes(page, itemSpec, input) {
    log(itemSpec, `Loading users who liked the post.`);

    const limit = input.likedByLimit;

    const nodeTransformationFunction = (data) => {
        if (!data.shortcode_media) throw new Error('Liked by GraphQL query does not contain shortcode_media');
        if (!data.shortcode_media.edge_liked_by) throw new Error('Liked by GraphQL query does not contain edge_liked_by');
        const likedBy = data.shortcode_media.edge_liked_by;
        const pageInfo = likedBy.page_info;
        const endCursor = pageInfo.end_cursor;
        const likes = likedBy.edges.map((like) => like.node);
        return { nextPageCursor: endCursor, data: likes };
    }

    const variables = {
        shortcode: itemSpec.id,
        include_reel: false,
    };

    return finiteQuery(likesQueryId, variables, nodeTransformationFunction, limit, page, input, itemSpec, '[post likes]');
}

module.exports = {
    getPostLikes,
};