/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/cache','./Constant'], (cache,Constant) => {

    const CACHE_NAME = CACHE_DETAIL.CACHE_NAME;

    const get = (request) => {
        return checkStatus(request || {});
    }

    const checkStatus = (request) => {

        try {

            const jobId = request.jobId;

            if (!jobId) {
                return JSON.stringify({
                    success: false,
                    error: ERROR_CODES.MISSING_PARAM,
                    message:RETURN_MESSAGE.MISSING_PARAM_MSSG_2
                });
            }

            const statusCache = cache.getCache({
                name: CACHE_NAME,
                scope: cache.Scope.PUBLIC
            });

            // loader returns NOT_FOUND instead of throwing if key is missing
            const raw = statusCache.get({
                key: jobId,
                loader: () => JSON.stringify({ status:status.NOT_FOUND })
            });

            const status = JSON.parse(raw);

            return JSON.stringify({
                success: true,
                jobId: jobId,
                ...status
            });

        } catch (e) {

            log.error({ title: LOG_TITLE.ERR_STATUS_TITLE, details: e });

            return JSON.stringify({
                success: false,
                error: e.name || 'ERROR',
                message: e.message || String(e)
            });
        }
    };

    return { get: get };

});