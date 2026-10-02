/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

define([], () => {

    const STATUS = {
       COMPLETE: 'COMPLETE',
       FAILED: 'FAILED',
       PENDING: 'PENDING',
       SUBMITTED: 'SUBMITTED',
       PROCESSING: 'PROCESSING',
       NOT_FOUND: 'NOT FOUND'
    };

    const ERROR_CODES = {
        MISSING_PARAM:'MISSING_PARAM',
        ALREADY_RUNNING: 'ALREADY_RUNNING',
        USER_DEF_ERR: 'SCRIPT_ALREADY_RUNNING'
    };

    const LOG_TITLE={
        EXPORT_TITLE_1:'Export Trigger Received',
        EXPORT_TITLE_2:'Export Already In Progress',
        EXPORT_TITLE_3: 'Checking - Export Trigger Received',
        SCRIPT_TITLE_1: 'SC Already Running (platform-level)',
        SCRIPT_TITLE_2:'SC Task Submitted',
        ERR_EXPORT_TITLE_1:'Export Trigger Error',
        ERR_STATUS_TITLE:'Status Check Error',
        ERR_DOWNLOAD_TITLE:'Download Chunk Error',
        SEARCH_EXPORT_TITLE:'Search Export Submitted',
        EXPORT_FAILED_TITLE:'Export Failed'
    };

    const RETURN_MESSAGE = {
        MISSING_PARAM_MSSG_1:'SearchId is required',
        MISSING_PARAM_MSSG_2:'JobId is required',
        MISSING_PARAM_MSSG_3:'FileId is required',

        ALREADY_RUNNING_MSSG_1:'An export is already running for this search. ' +
                            'Please wait for it to finish before starting a new one. ' +
                            'Check the Schedule Script Status page in NetSuite ' +
                            'for progress.',

        FAILED_MSSG:'Search export task failed',

        MESSAGE_1:'An export for this search is already running. ' +
                            'Poll the status RESTlet with this jobId instead ' +
                            'of triggering a new one. If you believe this is ' +
                            'stuck, pass force=true to start a fresh job.',

        MESSAGE_2:'Export started. Poll status RESTlet with this jobId.',

        ERR_PARAM_MSSG_1:'Search Id is required.',
        ERR_PARAM_MSSG_2:'Folder Id is required.'

        
    };

    const TIMINGS = {
         MAX_WAIT_MS:10 * 60 * 1000,
         POLL_EVERY_MS:5000,
         STALE_MINUTES: 30
    };

    const CACHE_DETAIL = {
        CACHE_NAME:'CSV_EXPORT_STATUS', 
        CACHE_TT_SECOND:60 * 60 * 24,
        ACTIVE_JOB_CACHE_NAME: 'CSV_EXPORT_ACTIVE_JOB'
    };

    const PARAMETER_ID = {
        SEARCH_ID:'custscript_search_id',
        FOLDER_ID:'custscript_folder_id',
        JOB_ID:'custscript_job_id'
    };

    return {
        STATUS,
        ERROR_CODES,
        CACHE_DETAIL,
        PARAMETER_ID,
        LOG_TITLE,
        RETURN_MESSAGE,
        TIMINGS

    };
});