const Apify = require('apify');
const { log } = require('./helpers');
const { PAGE_TYPES } = require('./consts');

const formatIGTVVideo = (edge) => {
    const { node } = edge;
    return {
        type: 'Video',
        shortCode: node.shortcode,
        title: node.title,
        caption: node.edge_media_to_caption.edges.length ? node.edge_media_to_caption.edges[0].node.text : '',
        commentsCount: node.edge_media_to_comment.count,
        commentsDisabled: node.comments_disabled,
        dimensionsHeight: node.dimensions.height,
        dimensionsWidth: node.dimensions.width,
        displayUrl: node.display_url,
        likesCount: node.edge_liked_by ? node.edge_liked_by.count : null,
        videoDuration: node.video_duration || 0,
        videoViewCount: node.video_view_count,

    }
};

const formatDisplayResources = (resources) => {
    if (!resources) return [];
    return resources.map((resource) => resource.src);
};

const formatSinglePost = (node) => ({
    type: node.__typename ? node.__typename.replace('Graph', '') : (node.is_video ? 'Video' : 'Image'),
    shortCode: node.shortcode,
    caption: node.edge_media_to_caption.edges.length ? node.edge_media_to_caption.edges[0].node.text : '',
    commentsCount: node.edge_media_to_comment.count,
    dimensionsHeight: node.dimensions.height,
    dimensionsWidth: node.dimensions.width,
    displayUrl: node.display_url,
    likesCount: node.edge_liked_by ? node.edge_liked_by.count : null,
    videoDuration: node.video_duration,
    videoViewCount: node.video_view_count,
    timestamp: node.taken_at_timestamp ? new Date(parseInt(node.taken_at_timestamp) * 1000) : null,
    locationName: node.location ? node.location.name : null,
    ownerFullName: node.owner ? node.owner.full_name : null,
});

const uppercaseFirstLetter = (word) => {
    const uppercasedLetter = word.charAt(0).toUpperCase();
    const restOfTheWord = word.slice(1);
    return `${uppercasedLetter}${restOfTheWord}`;
}
// ": "{\"street_address\": \"\", \"zip_code\": \"\", \"city_name\": \"Prague, Czech Republic\", \"region_name\": \"\", \"country_code\": \"CZ\", \"exact_city_match\": false, \"exact_region_match\": false, \"exact_country_match\": false}",
const formatJSONAddress = (jsonAddress) => {
    if (!jsonAddress) return '';
    let address;
    try {
        address = JSON.parse(jsonAddress);
    } catch (err) {
        return '';
    }
    const result = {};
    Object.keys(address).forEach((key) => {
        const parsedKey = key.split('_').map(uppercaseFirstLetter).join('');
        result[`address${parsedKey}`] = address[key]; 
    });
    return result;
}

const formatProfileOutput = (request, data) => ({
    '#debug': {
        url: request.url,
    },
    id: data.id,
    username: data.username,
    fullName: data.full_name,
    biography: data.biography,
    externalUrl: data.external_url,
    externalUrlShimmed: data.external_url_linkshimmed,
    followersCount: data.edge_followed_by.count,
    followsCount: data.edge_follow.count,
    hasChannel: data.has_channel,
    highlightReelCount: data.highlight_reel_count,
    isBusinessAccount: data.is_business_account,
    joinedRecently: data.is_joined_recently,
    businessCategoryName: data.business_category_name,
    private: data.is_private,
    verified: data.is_verified,
    profilePicUrl: data.profile_pic_url,
    profilePicUrlHD: data.profile_pic_url_hd,
    facebookPage: data.connected_fb_page,
    igtvVideoCount: data.edge_felix_video_timeline.count,
    latestIgtvVideos: data.edge_felix_video_timeline ? data.edge_felix_video_timeline.edges.map(formatIGTVVideo) : [],
    postsCount: data.edge_owner_to_timeline_media.count,
    latestPosts: data.edge_owner_to_timeline_media ? data.edge_owner_to_timeline_media.edges.map((edge) => edge.node).map(formatSinglePost) : [],
});

const formatPlaceOutput = (request, data) => ({
    '#debug': {
        url: request.url,
    },
    id: data.id,
    name: data.name,
    public: data.has_public_page,
    lat: data.lat,
    lng: data.lng,
    slug: data.slug,
    description: data.blurb,
    website: data.website,
    phone: data.phone,
    aliasOnFacebook: data.primary_alias_on_fb,
    ...formatJSONAddress(data.address_json),
    profilePicUrl: data.profile_pic_url,
    postsCount: data.edge_location_to_media.count,
    topPosts: data.edge_location_to_top_posts ? data.edge_location_to_top_posts.edges.map((edge) => edge.node).map(formatSinglePost) : [],
    latestPosts: data.edge_location_to_media ? data.edge_location_to_media.edges.map((edge) => edge.node).map(formatSinglePost) : [],
});

const formatHashtagOutput = (request, data) => ({
    '#debug': {
        url: request.url,
    },
    id: data.id,
    name: data.name,
    public: data.has_public_page,
    topPostsOnly: data.is_top_media_only,
    profilePicUrl: data.profile_pic_url,
    postsCount: data.edge_hashtag_to_media.count,
    topPosts: data.edge_hashtag_to_top_posts ? data.edge_hashtag_to_top_posts.edges.map((edge) => edge.node).map(formatSinglePost) : [],
    latestPosts: data.edge_hashtag_to_media ? data.edge_hashtag_to_media.edges.map((edge) => edge.node).map(formatSinglePost) : [],
});

const formatPostOutput = (request, data) => ({
    '#debug': {
        url: request.url,
    },
    ...formatSinglePost(data),
    captionIsEdited: typeof data.caption_is_edited !== 'undefined' ? data.caption_is_edited : null,
    hasRankedComments: data.has_ranked_comments,
    commentsDisabled: data.comments_disabled,
    displayResourceUrls: formatDisplayResources(data.display_resources),
    locationSlug: data.location ? data.location.slug : null,
    ownerUsername: data.owner ? data.owner.username : null,
    isAdvertisement: typeof data.is_ad !== 'undefined' ? data.is_ad : null,
    taggedUsers: data.edge_media_to_tagged_user ? data.edge_media_to_tagged_user.edges.map((edge) => edge.node.user.username) : [],
    latestComments: data.edge_media_to_comment ? data.edge_media_to_comment.edges.map((edge) => ({
        ownerUsername: edge.node.owner ? edge.node.owner.username : '',
        text: edge.node.text,
    })).reverse() : [],
});

const getOutputFromEntryData = (pageType, request, data) => {
    switch (pageType) {
        case PAGE_TYPES.PLACE: return formatPlaceOutput(request, data.LocationsPage[0].graphql.location);
        case PAGE_TYPES.PROFILE: return formatProfileOutput(request, data.ProfilePage[0].graphql.user);
        case PAGE_TYPES.HASHTAG: return formatHashtagOutput(request, data.TagPage[0].graphql.hashtag);
        case PAGE_TYPES.POST: return formatPostOutput(request, data.PostPage[0].graphql.shortcode_media);
    }
};

const scrapeDetails = async (request, itemSpec, entryData) => {
    const output = getOutputFromEntryData(itemSpec.pageType, request, entryData);
    await Apify.pushData(output);
    log(itemSpec, `Page details saved, task finished`);
};


module.exports = {
    scrapeDetails,
};