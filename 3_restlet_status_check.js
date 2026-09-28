/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/cache'], (cache) => {

    const CACHE_NAME = 'CSV_EXPORT_STATUS';

    const get = (request) => {
        return checkStatus(request || {});
    }

    const checkStatus = (request) => {

        try {

            const jobId = request.jobId;

            if (!jobId) {
                return JSON.stringify({
                    success: false,
                    error: 'MISSING_PARAM',
                    message: 'jobId is required'
                });
            }

            const statusCache = cache.getCache({
                name: CACHE_NAME,
                scope: cache.Scope.PUBLIC
            });

            // loader returns NOT_FOUND instead of throwing if key is missing
            const raw = statusCache.get({
                key: jobId,
                loader: () => JSON.stringify({ status: 'NOT_FOUND' })
            });

            const status = JSON.parse(raw);

            return JSON.stringify({
                success: true,
                jobId: jobId,
                ...status
            });

        } catch (e) {

            log.error({ title: 'Status Check Error', details: e });

            return JSON.stringify({
                success: false,
                error: e.name || 'ERROR',
                message: e.message || String(e)
            });
        }
    };

    return { get: get };

});