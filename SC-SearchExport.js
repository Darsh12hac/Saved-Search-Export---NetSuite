/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 */
define(['N/task', 'N/runtime', 'N/cache', 'N/search'],
(task, runtime, cache, search) => {

    const CACHE_NAME = 'CSV_EXPORT_STATUS';
    const CACHE_TTL_SECONDS = 86400;
    const MAX_WAIT_MS = 10 * 60 * 1000;   // max wait 10 min
    const POLL_EVERY_MS = 5000;           // har 5 sec mein ek check

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
            log.error({ title: 'Cache Update Failed', details: e });
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
        const searchId = script.getParameter({ name: 'custscript_search_id' });
        const folderId = script.getParameter({ name: 'custscript_folder_id' });
        const jobId = script.getParameter({ name: 'custscript_job_id' })
            || Date.now().toString();

        let taskId = null;
        let fileName = null;

        try {

            if (!searchId) throw Error('Search Id is required.');
            if (!folderId) throw Error('Folder Id is required.');

            setStatus(jobId, {
                status: 'PROCESSING',
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
                title: 'Search Export Submitted',
                details: { taskId, jobId, searchId, folderId, fileName, folderPath }
            });

            setStatus(jobId, {
                status: 'SUBMITTED',
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
                    status: 'FAILED',
                    taskId: taskId,
                    searchId: searchId,
                    folderId: folderId,
                    fileName: fileName,
                    message: 'Search export task failed',
                    failedAt: new Date().toISOString()
                });

            } else if (result.done) {
              const finalFileId = result.fileId || findFileIdByName(fileName, folderId);
              
                setStatus(jobId, {
                    status: 'COMPLETE',
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

            log.error({ title: 'Export Failed', details: e });

            setStatus(jobId, {
                status: 'FAILED',
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
