/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/task', 'N/runtime', 'N/cache', 'N/search','./Constant'],
(task, runtime, cache, search,Constant) => {

    const CACHE_NAME = CACHE_DETAIL.CACHE_NAME;
    const CACHE_TTL_SECONDS = CACHE_DETAIL.CACHE_TTL_SECONDS;

    const MAX_WAIT_MS = TIMINGS.MAX_WAIT_MS;   
    const POLL_EVERY_MS = TIMINGS.POLL_EVERY_MS;         

    const getStatusCache = () => cache.getCache({
        name: CACHE_NAME,
        scope: cache.Scope.PUBLIC
    });

    const setStatus = (jobId, statusObj) => {
        try {
            getStatusCache().put({
                key: jobId,
                value: JSON.stringify(statusObj),
                ttl: CACHE_TTL_SECONDS
            });
        } catch (e) {
            log.error({ title: LOG_TITLE.MISSING_PARAM_MSSG_3, details: e });
        }
    };

    const getFolderPath = (folderId) => {
        const pathParts = [];
        let currentFolderId = folderId;

        while (currentFolderId) {
            const folderData = search.lookupFields({
                type: search.Type.FOLDER,
                id: currentFolderId,
                columns: ['name', 'parent']
            });

            pathParts.unshift(folderData.name);

            currentFolderId = folderData.parent && folderData.parent.length
                ? folderData.parent[0].value
                : null;
        }

        return '/' + pathParts.join('/');
    };

    // SuiteScript mein sleep() nahi hai, isliye Date.now() se delay
    const pause = (ms) => {
        const end = Date.now() + ms;
        while (Date.now() < end) { /* wait */ }
    };

    const waitForTask = (taskId, maxWaitMs) => {
        const startedAt = Date.now();

        while (Date.now() - startedAt < maxWaitMs) {
            const ts = task.checkStatus({ taskId: taskId });

            if (ts.status === task.TaskStatus.COMPLETE) {
                return { done: true, fileId: ts.fileId || null };
            }
            if (ts.status === task.TaskStatus.FAILED) {
                return { done: true, failed: true };
            }

            pause(POLL_EVERY_MS);
        }

        return { done: false };   // timeout, status RESTlet baad mein sambhal lega
    };

    const findFileIdByName = (fileName, folderId) => {
        const hit = search.create({
            type: 'file',
            filters: [
                ['name', 'is', fileName], 'AND',
                ['folder', 'anyof', folderId]
            ],
            columns: ['internalid']
        }).run().getRange({ start: 0, end: 1 });

        return hit.length ? hit[0].id : null;
    };

    const execute = () => {

        const script = runtime.getCurrentScript();
        const searchId = script.getParameter({ name: PARAMETER_ID.SEARCH_ID });
        const folderId = script.getParameter({ name: PARAMETER_ID.FOLDER_ID });
        const jobId = script.getParameter({ name: PARAMETER_ID.JOB_ID })
            || Date.now().toString();

        let taskId = null;
        let fileName = null;

        try {

            if (!searchId) throw Error(RETURN_MESSAGE.ERR_PARAM_MSSG_1);
            if (!folderId) throw Error(RETURN_MESSAGE.ERR_PARAM_MSSG_2);

            setStatus(jobId, {
                status:STATUS.PROCESSING,
                searchId: searchId,
                folderId: folderId,
                startedAt: new Date().toISOString()
            });

            const folderPath = getFolderPath(folderId);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            fileName = `${searchId}_${timestamp}.csv`;

            const exportTask = task.create({ taskType: task.TaskType.SEARCH });
            exportTask.savedSearchId = searchId;
            exportTask.filePath = `${folderPath}/${fileName}`;

            taskId = exportTask.submit();

            log.audit({
                title: LOG_TITLE.SEARCH_EXPORT_TITLE,
                details: { taskId, jobId, searchId, folderId, fileName, folderPath }
            });

            setStatus(jobId, {
                status:STATUS.SUBMITTED,
                taskId: taskId,
                searchId: searchId,
                folderId: folderId,
                fileName: fileName,
                folderPath: folderPath,
                submittedAt: new Date().toISOString(),
                startedAt: new Date().toISOString()
            });

            const result = waitForTask(taskId, MAX_WAIT_MS);

            if (result.done && result.failed) {

                setStatus(jobId, {
                    status:STATUS.FAILED,
                    taskId: taskId,
                    searchId: searchId,
                    folderId: folderId,
                    fileName: fileName,
                    message: RETURN_MESSAGE.FAILED_MSSG,
                    failedAt: new Date().toISOString()
                });

            } else if (result.done) {
              const finalFileId = result.fileId || findFileIdByName(fileName, folderId);
              
                setStatus(jobId, {
                    status: STATUS.COMPLETE,
                    taskId: taskId,
                    searchId: searchId,
                    folderId: folderId,
                    fileName: fileName,
                    fileId: finalFileId,
                    completedAt: new Date().toISOString()
                });
            }
            // timeout: status SUBMITTED hi rehta hai, status RESTlet checkStatus se update karega

        } catch (e) {

            log.error({ title: LOG_TITLE.EXPORT_FAILED_TITLE, details: e });

            setStatus(jobId, {
                status: STATUS.FAILED,
                taskId: taskId,
                searchId: searchId,
                folderId: folderId,
                fileName: fileName,
                error: e.name || 'ERROR',
                message: e.message || String(e),
                failedAt: new Date().toISOString()
            });

            throw e;
        }
    };

    return { execute };
});
