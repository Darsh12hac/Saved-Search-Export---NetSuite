/**
* @NApiVersion 2.1
* @NScriptType MapReduceScript
*/
define(['N/search', 'N/file', 'N/runtime', 'N/cache'], (search, file, runtime, cache) => {
 
    const CACHE_NAME = 'CSV_EXPORT_STATUS';
    const CACHE_TTL_SECONDS = 60 * 60 * 3;
 
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
            log.error({ title: 'Failed to write status cache', details: e });
        }
    };
 
    // CSV field escaping
    const escapeCsvField = (value) => {
 
        if (value === null || value === undefined) {
            value = '';
        }
 
        // Select/list fields sometimes serialize as {value, text}
        if (typeof value === 'object') {
            value = value.text !== undefined ? value.text : value.value;
        }
 
        value = String(value)
            .replace(/"/g, '""')
            .replace(/\r?\n|\r/g, ' ');
 
        return '"' + value + '"';
    };
 
    // Stage 1: get input data
    const getInputData = (inputContext) => {
 
        const script = runtime.getCurrentScript();
 
        const searchId = script.getParameter({ name: 'custscript_mr_search_id' });
        const jobId = script.getParameter({ name: 'custscript_mr_job_id' });
 
        log.audit({
            title: 'MR Export Starting',
            details: { searchId: searchId, jobId: jobId }
        });
 
        setStatus(jobId, {
            status: 'PROCESSING',
            stage: 'GET_INPUT_DATA',
            searchId: searchId,
            startedAt: new Date().toISOString()
        });
 
        try {
 
            // NetSuite paginates internally when a search object is returned here
            return search.load({ id: searchId });
 
        } catch (e) {
 
            // Without this catch, a failure here leaves status stuck at PROCESSING forever
            log.error({ title: 'Get Input Data Error', details: e });
 
            setStatus(jobId, {
                status: 'FAILED',
                searchId: searchId,
                error: e.name || 'ERROR',
                message: e.message || String(e),
                failedAt: new Date().toISOString()
            });
 
            throw e;
        }
    };
 
    // Stage 2: map - one call per search result row
    const map = (mapContext) => {
 
        try {
 
            const script = runtime.getCurrentScript();
 
            const columns = JSON.parse(
                script.getParameter({ name: 'custscript_mr_columns' })
            );
 
            const result = JSON.parse(mapContext.value);
            const rawValues = result.values || {};
 
            // Compact array (not labeled object) - keeps persisted data small
            const row = columns.map((col) => {
                const key = (col.join ? col.join + '.' : '') + col.name;
                return rawValues[key];
            });
 
            // No reduce stage -> this becomes the final output for summarize()
            mapContext.write({
                key: mapContext.key,
                value: JSON.stringify(row)
            });
 
        } catch (e) {
 
            log.error({
                title: 'Map Stage Error',
                details: { error: e.message || String(e), key: mapContext.key }
            });
            // Swallow per-row errors so one bad record doesn't kill the export
        }
    };
 
    // Stage 3: summarize - build and save the CSV file
    const summarize = (summaryContext) => {
 
        const script = runtime.getCurrentScript();
 
        const jobId = script.getParameter({ name: 'custscript_mr_job_id' });
        const searchId = script.getParameter({ name: 'custscript_mr_search_id' });
        const folderId = parseInt(
            script.getParameter({ name: 'custscript_mr_folder_id' }), 10
        );
        const columns = JSON.parse(
            script.getParameter({ name: 'custscript_mr_columns' })
        );
 
        try {
 
            let mapErrorCount = 0;
            summaryContext.mapSummary.errors.iterator().each((key, error) => {
                mapErrorCount++;
                log.error({ title: 'Map error for key ' + key, details: error });
                return true;
            });
 
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = searchId + '_' + timestamp + '.csv';
 
            // FIX: `contents` is a required parameter for file.create() even
            // when you plan to build the file entirely via appendLine().
            // Without it, this throws SSS_MISSING_REQD_ARGUMENT: contents,
            // which was being caught below and silently turning every job
            // into a FAILED status.
            const csvFile = file.create({
                name: fileName,
                fileType: file.Type.CSV,
                contents: '',
                folder: folderId,
                isOnline: false
            });
 
            // Header row
            const headerLine = columns
                .map((col) => escapeCsvField(col.label))
                .join(',');
 
            csvFile.appendLine({ value: headerLine });
 
            // Data rows - appendLine keeps memory flat regardless of row count
            let totalRows = 0;
 
            summaryContext.output.iterator().each((key, value) => {
 
                const rowArray = JSON.parse(value);
 
                const line = columns
                    .map((col, index) => escapeCsvField(rowArray[index]))
                    .join(',');
 
                csvFile.appendLine({ value: line });
 
                totalRows++;
 
                return true;
            });
 
            const fileId = csvFile.save();
 
            // Sanity check - don't report success on an empty/short export
            const expectedTotal = search.load({ id: searchId }).runPaged().count;
 
            if (totalRows === 0 || totalRows < expectedTotal) {
 
                log.error({
                    title: 'Row Count Mismatch',
                    details: { expectedTotal: expectedTotal, totalRows: totalRows }
                });
 
                setStatus(jobId, {
                    status: 'FAILED',
                    searchId: searchId,
                    error: 'ROW_COUNT_MISMATCH',
                    message: `Expected ${expectedTotal} rows but only got ${totalRows}. `
                        + 'This usually means the run hit a Map/Reduce data limit '
                        + '(check Buffer Size on the deployment) or was interrupted.',
                    expectedTotal: expectedTotal,
                    totalRows: totalRows,
                    fileId: fileId,
                    failedAt: new Date().toISOString()
                });
 
                return;
            }
 
            log.audit({
                title: 'MR Export Completed',
                details: {
                    jobId: jobId,
                    fileId: fileId,
                    fileName: fileName,
                    totalRows: totalRows,
                    mapErrorCount: mapErrorCount
                }
            });
 
            setStatus(jobId, {
                status: 'COMPLETE',
                searchId: searchId,
                fileId: fileId,
                fileName: fileName,
                totalRows: totalRows,
                mapErrorCount: mapErrorCount,
                completedAt: new Date().toISOString()
            });
 
        } catch (e) {
 
            log.error({ title: 'Summarize Stage Error', details: e });
 
            setStatus(jobId, {
                status: 'FAILED',
                searchId: searchId,
                error: e.name || 'ERROR',
                message: e.message || String(e),
                failedAt: new Date().toISOString()
            });
        }
    };
 
    return {
        getInputData: getInputData,
        map: map,
        summarize: summarize
    };
 
});