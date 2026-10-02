/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/file','./Constant'], (file,Constant) => {

    const DEFAULT_LINE_COUNT = 5000; // lines per chunk

    const get = (request) => {
        return downloadChunk(request || {});
    };

    const downloadChunk = (request) => {

        try {

            const fileId = request.fileId;

            if (!fileId) {
                return JSON.stringify({
                    success: false,
                    error: ERROR_CODES.MISSING_PARAM,
                    message: RETURN_MESSAGE.MISSING_PARAM_MSSG_3
                });
            }

            const startLine = parseInt(request.startLine || '0', 10);
            const lineCount = parseInt(request.lineCount || DEFAULT_LINE_COUNT, 10);

            const loadedFile = file.load({ id: fileId });

            // Line iterator instead of getContents() - no 10MB size ceiling
            const collected = [];
            let idx = 0;
            let hasMore = false;

            loadedFile.lines.iterator().each((line) => {

                if (idx < startLine) {
                    idx++;
                    return true; // skip ahead to startLine
                }

                if (collected.length < lineCount) {
                    collected.push(line.value);
                    idx++;
                    return true;
                }

                hasMore = true; // full chunk collected, more data remains
                return false;
            });

            return JSON.stringify({
                success: true,
                fileId: fileId,
                fileName: loadedFile.name,
                startLine: startLine,
                lineCount: collected.length,
                nextStartLine: hasMore ? (startLine + collected.length) : null,
                hasMore: hasMore,
                lines: collected
            });

        } catch (e) {

            log.error({ title: LOG_TITLE.ERR_DOWNLOAD_TITLE, details: e });

            return JSON.stringify({
                success: false,
                error: e.name || 'ERROR',
                message: e.message || String(e)
            });
        }
    };

    return { get: get };

});