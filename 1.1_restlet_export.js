/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/search', 'N/task', 'N/cache','./Constant'], (search, task, cache,Constant) => {


    const CACHE_NAME = CACHE_DETAIL.CACHE_NAME;
    const CACHE_TTL_SECONDS =CACHE_DETAIL.CACHE_TTL_SECONDS;

    // Tracks the active jobId per searchId, so repeat triggers reuse it
    const ACTIVE_JOB_CACHE_NAME = CACHE_DETAIL.ACTIVE_JOB_CACHE_NAME;

    const get = (request) => {
        return triggerExport(request || {});
    };

    const post = (request) => {
        return triggerExport(request || {});
    };

    const triggerExport = (request) => {

            const scriptId = request.scriptId;
            const deploymentId = request.deploymentId;


        try {
            
           
            const searchId = request.searchId;

            if (!searchId) {
                return JSON.stringify({
                    success: false,
                    error: ERROR_CODES.MISSING_PARAM,
                    message: RETURN_MESSAGE.MISSING_PARAM_MSSG_1
                });
            }

            const folderId =
                parseInt(request.folderId );  // || DEFAULT_FOLDER_ID, 10

            log.audit({
                title: LOG_TITLE.EXPORT_TITLE_1,
                details: { searchId: searchId, folderId: folderId , scriptId : scriptId, deploymentId: deploymentId }
            });

            // Check for an already-running job for this searchId
            const activeJobCache = cache.getCache({
                name: ACTIVE_JOB_CACHE_NAME,
                scope: cache.Scope.PUBLIC
            });

            const statusCachePreCheck = cache.getCache({
                name: CACHE_NAME,
                scope: cache.Scope.PUBLIC
            });

            let existingJobId = null;

            try {
                existingJobId = activeJobCache.get({
                    key: searchId,
                    loader: () => null
                });
            } catch (e) {
                existingJobId = null;
            }

            if (existingJobId && !request.force) {

                let existingStatusRaw = null;

                try {
                    existingStatusRaw = statusCachePreCheck.get({
                        key: existingJobId,
                        loader: () => null
                    });
                } catch (e) {
                    existingStatusRaw = null;
                }

                const existingStatus = existingStatusRaw
                    ? JSON.parse(existingStatusRaw)
                    : null;

                // Ignore jobs stuck for too long (likely failed at the platform level)
                const STALE_MINUTES = TIMEINGS.STALE_MINUTES;
                let isStale = false;

                if (existingStatus) {
                    const referenceTime = existingStatus.completedAt
                        || existingStatus.failedAt
                        || existingStatus.startedAt
                        || existingStatus.createdAt;
                    const ageMinutes = referenceTime
                        ? (Date.now() - new Date(referenceTime).getTime()) / 60000
                        : Infinity;
                    isStale = ageMinutes > STALE_MINUTES;
                }

                const stillRunning =
                    existingStatus &&
                    existingStatus.status !== STATUS.COMPLETE &&
                    existingStatus.status !== STATUS.FAILED &&
                    !isStale;

                if (stillRunning) {

                    log.audit({
                        title:LOG_TITLE.EXPORT_TITLE_2,
                        details: { searchId: searchId, jobId: existingJobId }
                    });

                    return JSON.stringify({
                        success: true,
                        alreadyInProgress: true,
                        jobId: existingJobId,
                        searchId: searchId,
                        status: existingStatus.status,
                        message:RETURN_MESSAGE.MESSAGE_1
                    });
                }
            }

            // Load search definition only - fast, no data read
            const savedSearch = search.load({ id: searchId });

            const columns = savedSearch.columns.map((column, index) => {

                const label =
                    column.label ||
                    ((column.join ? column.join + '.' : '') + column.name);

                return {
                    name: column.name,
                    join: column.join || '',
                    label: String(label)
                };
            });

            // Build job id + initial status
            const jobId = searchId + '_' + Date.now();

            const statusCache = cache.getCache({
                name: CACHE_NAME,
                scope: cache.Scope.PUBLIC
            });

            statusCache.put({
                key: jobId,
                value: JSON.stringify({
                    status: STATUS.PENDING,
                    searchId: searchId,
                    createdAt: new Date().toISOString()
                }),
                ttl: CACHE_TTL_SECONDS
            });

            // Record as active job before submitting, to catch race conditions
            activeJobCache.put({
                key: searchId,
                value: jobId,
                ttl: CACHE_TTL_SECONDS
            });

            // Submit the Script task
            let taskId;

            try {

                const scTask = task.create({
                    taskType: task.TaskType.SCHEDULED_SCRIPT,
                    scriptId: scriptId,
                    deploymentId: deploymentId,
                  
                    params: {
                        custscript_search_id: searchId,
                        custscript_folder_id: folderId,
                        custscript_columns: JSON.stringify(columns),
                        custscript_job_id: jobId
                    }
                });
              

            log.audit({
                title:LOG_TITLE.EXPORT_TITLE_3,
                details: { searchId: searchId, folderId: folderId , scriptId : scriptId, deploymentId: deploymentId }
            });
                taskId = scTask.submit();

            } catch (submitError) {

                // Translate the platform-level "already running" error into a clean response
                if (submitError.name === ERROR_CODES.USER_DEF_ERR ||
                    (submitError.message || '').indexOf('already running') !== -1) {

                    log.audit({
                        title: LOG_TITLE.SCRIPT_TITLE_1,
                        details: { searchId: searchId, jobId: jobId }
                    });

                    return JSON.stringify({
                        success: false,
                        error: ERROR_CODES.ALREADY_RUNNING,
                        message: RETURN_MESSAGE.ALREADY_RUNNING_MSSG_1

                    });
                }

                throw submitError;
            }

            log.audit({
                title: LOG_TITLE.SCRIPT_TITLE_2,
                details: { jobId: jobId, taskId: taskId, searchId: searchId }
            });

            return JSON.stringify({
                success: true,
                jobId: jobId,
                taskId: taskId,
                searchId: searchId,
                message: RETURN_MESSAGE.MESSAGE_2
            });

        } catch (e) {

            log.error({ title: LOG_TITLE.ERR_EXPORT_TITLE_1, details: e });

            return JSON.stringify({
                success: false,
                error: e.name || 'ERROR',
                message: e.message || String(e)
            });
        }
    };

    return { get: get, post: post };

});