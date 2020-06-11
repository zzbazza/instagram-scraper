const loadMore = async (pageData, page, retry = 0) => {
    await page.keyboard.press('PageUp');
    const checkedVariable = getCheckedVariable(pageData.pageType);
    const responsePromise = page.waitForResponse(
        (response) => {
            const responseUrl = response.url();
            return responseUrl.startsWith(GRAPHQL_ENDPOINT)
                && responseUrl.includes(checkedVariable)
                && responseUrl.includes('%22first%22');
        },
        { timeout: 100000 },
    );

    let clicked = [];
    for (let i = 0; i < 10; i++) {
        const elements = await page.$$('[aria-label="Load more comments"]');
        if (elements.length === 0) {
            break;
        }

        const [button] = elements;

        clicked = await Promise.all([
            button.click(),
            page.waitForRequest(
                (request) => {
                    const requestUrl = request.url();
                    return requestUrl.startsWith(GRAPHQL_ENDPOINT)
                        && requestUrl.includes(checkedVariable)
                        && requestUrl.includes('%22first%22');
                },
                {
                    timeout: 1000,
                },
            ).catch(() => null),
        ]);
        if (clicked[1]) break;
    }

    let data = null;
    let rateLimited = false;
    if (clicked[1]) {
        try {
            const response = await responsePromise;
            const json = await response.json();
            const status = await response.status();
            // console.log('Scroll status:', status);
            if (status === 429) {
                rateLimited = true;
                console.log('Scroll text:', text);
            }
            // eslint-disable-next-line prefer-destructuring
            if (json) data = json.data;
        } catch (error) {
            Apify.utils.log.error(error);
        }
    }

    if (rateLimited) {
        return { rateLimited: true };
    }

    if (!data && retry < 10) {
        const retryDelay = retry ? ++retry * retry * 1000 : ++retry * 1000;
        log(pageData, `Retry scroll after ${retryDelay / 1000} seconds`);
        await page.waitFor(retryDelay);
        return loadMore(pageData, page, retry);
    }

    // await page.waitFor(500);
    return { data };
};
