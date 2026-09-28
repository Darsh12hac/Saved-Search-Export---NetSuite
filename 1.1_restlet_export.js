/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/search', 'N/task', 'N/cache'], (search, task, cache) => {

    const SC_CONFIG = {
        scriptId: 'customscript_sc_searchexport_ss',
        deploymentId: 'customdeploy_scsearchexport_ss'
    };

    const DEFAULT_FOLDER_ID = 211737;

    const CACHE_NAME = 'CSV_EXPORT_STATUS';
    const CACHE_TTL_SECONDS = 60 * 60 * 24;

    // Tracks the active jobId per searchId, so repeat triggers reuse it
    const ACTIVE_JOB_CACHE_NAME = 'CSV_EXPORT_ACTIVE_JOB';

    const get = (request) => {
        return triggerExport(request || {});
    };

    const post = (request) => {
        return triggerExport(request || {});
    };

    const triggerExport = (request) => {

        try {

            const searchId = request.searchId;

            if (!searchId) {
                return JSON.stringify({
                    success: false,
                    error: 'MISSING_PARAM',
                    message: 'searchId is required'
                });
            }

            const folderId =
                parseInt(request.folderId || DEFAULT_FOLDER_ID, 10);

            log.audit({
                title: 'Export Trigger Received',
                details: { searchId: searchId, folderId: folderId }
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
                const STALE_MINUTES = 30;
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
                    existingStatus.status !== 'COMPLETE' &&
                    existingStatus.status !== 'FAILED' &&
                    !isStale;

                if (stillRunning) {

                    log.audit({
                        title: 'Export Already In Progress',
                        details: { searchId: searchId, jobId: existingJobId }
                    });

                    return JSON.stringify({
                        success: true,
                        alreadyInProgress: true,
                        jobId: existingJobId,
                        searchId: searchId,
                        status: existingStatus.status,
                        message:
                            'An export for this search is already running. ' +
                            'Poll the status RESTlet with this jobId instead ' +
                            'of triggering a new one. If you believe this is ' +
                            'stuck, pass force=true to start a fresh job.'
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
                    status: 'PENDING',
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

            // Submit the Map/Reduce task
            let taskId;

            try {

                const scTask = task.create({
                    taskType: task.TaskType.SCHEDULED_SCRIPT,
                    scriptId: SC_CONFIG.scriptId,
                    deploymentId: SC_CONFIG.deploymentId,
                    params: {
                        custscript_search_id: searchId,
                        custscript_folder_id: folderId,
                        custscript_columns: JSON.stringify(columns),
                        custscript_job_id: jobId
                    }
                });

                taskId = scTask.submit();

            } catch (submitError) {

                // Translate the platform-level "already running" error into a clean response
                if (submitError.name === 'SCRIPT_ALREADY_RUNNING' ||
                    (submitError.message || '').indexOf('already running') !== -1) {

                    log.audit({
                        title: 'SC Already Running (platform-level)',
                        details: { searchId: searchId, jobId: jobId }
                    });

                    return JSON.stringify({
                        success: false,
                        error: 'ALREADY_RUNNING',
                        message:
                            'An export is already running for this search. ' +
                            'Please wait for it to finish before starting a new one. ' +
                            'Check the Schedule Script Status page in NetSuite ' +
                            'for progress.'
                    });
                }

                throw submitError;
            }

            log.audit({
                title: 'SC Task Submitted',
                details: { jobId: jobId, taskId: taskId, searchId: searchId }
            });

            return JSON.stringify({
                success: true,
                jobId: jobId,
                taskId: taskId,
                searchId: searchId,
                message: 'Export started. Poll status RESTlet with this jobId.'
            });

        } catch (e) {

            log.error({ title: 'Export Trigger Error', details: e });

            return JSON.stringify({
                success: false,
                error: e.name || 'ERROR',
                message: e.message || String(e)
            });
        }
    };

    return { get: get, post: post };

});