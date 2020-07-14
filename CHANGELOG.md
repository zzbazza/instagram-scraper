### 2020-07-02 - Scraping places/locations now requires login.

### 2020-06-11 Big update with many fixes and new features

#### Bug fixes
- Blocked pages are immediately retried with another browser and IP address
- Pages that sometimes don’t load properly are immediately retried
- Posts and comments scroll down properly and are fully scraped
- Fixed some missing data points for posts and comments
- Reduced overall assets size so it consumes less network traffic (cheaper residential proxy)

#### New features
- Posts and comments are pushed as the page is scrolling (no need to wait for full scroll to get first data)
- Optional login with cookies
- Scrape posts until a specified date
- Expand post data with user detail info
- Optional following, followed and likes (requires login)
- Custom user-provided function to enhance the output (without need to change the code)
- Extracting mentions and hashtags from post captions
- Added more data points for users, posts and comments (don’t remember exactly check new readme)
- More descriptive log (shows current scraped posts/comments vs total)
