# Actor - Instagram scraper

## Instagram scraper

Since instagram has removed the option to load public data through API, this actor should help replace this functionality. It allows you to scrape
posts from a users profile page, hashtage page or place. When a link to an Instagram post is provided it can scrape Instagram comments.

*The only limitation of this solution is that it can only retrieve public data that are accessible through instagram webpage. Private profiles and hashtags with limited
post counts will not output all data.*

## Open source solution for instagram API
You can manage the results in any languague (Python, PHP, Node JS/NPM). See the FAQ or <a href="https://www.apify.com/docs/api" target="blank">our API reference</a> to learn more about getting results from this Instagram Actor.
The code of this Instagram actor is also open source, so you can create your own solution if you need.

## INPUT

Input of this actor should be JSON containing list of pages on instagram which should be visited. Required fields are:

| Field | Type | Description |
| ----- | ---- | ----------- |
| urls | Array | List of instagram URLs |
| type | String | What to scrape from each page, default is "posts" the other option is "comments" |
| limit | Integer | How many items should be loaded from each URL (limit is per page)  |
| proxy | Object | Proxy configuration |

### PROXY
This solution requires use of **Proxy servers**, either your own proxy servers or you can use <a href="https://www.apify.com/docs/proxy">Apify Proxy</a>.

### Input example
```json
{
    "urls": [ "https://www.instagram.com/teslamotors/" ],
    "type": "posts",
    "limit": 100,
    "proxy": { "useApifyProxy": true, "apifyProxyGrouups": [] }
}

```

## Run & Console output

During the run, the actor will output messages letting the you know what is going on. Each message always contains a short label specifying which page
from the provided list is currently specified.
When items are loaded from the page, you should see a message about this event with a loaded item count and total item count for each page.

If you provide incorrect input to the actor, it will immediately stop with Failure state and output an explanation of
what is wrong.

## Dataset items

During the run, the actor is storing results into dataset, each item is a separate item in the dataset.

### Instagram posts
Structure of each item in Instagram Posts looks like this:

```json
{
  "#debug": {
    "index": 1,
    "pageType": "user",
    "id": "teslamotors",
    "userId": "297604134",
    "userUsername": "teslamotors",
    "userFullName": "Tesla",
    "shortcode": "BwrsO1Bho2N",
    "postLocationId": "2172837629656184",
    "postOwnerId": "297604134"
  },
  "url": "https://www.instagram.com/p/BwrsO1Bho2N",
  "likesCount": 142707,
  "imageUrl": "https://scontent-ort2-2.cdninstagram.com/vp/ddc96ff719e514e118da40af30c21e44/5D625C61/t51.2885-15/e35/57840129_308705413159630_8358160330083042716_n.jpg?_nc_ht=scontent-ort2-2.cdninstagram.com",
  "firstComment": "Newly upgraded Model S and X drive units rolling down the production line at Gigafactory 1",
  "timestamp": "2019-04-25T14:57:01.000Z",
  "locationName": "Tesla Gigafactory 1",
  "ownerUsername": "teslamotors"
}
```

### Instagram comments
Structure of each item in Instagram Comments looks like this:

```json
{
  "#debug": {
    "index": 13,
    "pageType": "post",
    "id": "Bw7jACTn3tC",
    "postCommentsDisabled": false,
    "postIsVideo": true,
    "postVideoViewCount": 418505,
    "postVideoDurationSecs": 13.05
  },
  "id": "17847980458427200",
  "text": "#thankyouavengers",
  "timestamp": null,
  "ownerId": "3821638094",
  "ownerIsVerified": false,
  "ownerUsername": "exelya_alvyolita",
  "ownerProfilePicUrl": "https://scontent-ort2-1.cdninstagram.com/vp/b12a3649da329b32a3d7f0d2127d5033/5D6141DD/t51.2885-19/s150x150/54446808_273968013485672_6984748001717649408_n.jpg?_nc_ht=scontent-ort2-1.cdninstagram.com"
}
```