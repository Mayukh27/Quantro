import api from './axiosConfig';
export const getActiveExams = () => api.get('/exams/active');
export const getUpcomingExams = () => api.get('/exams/upcoming');
export const getAllExams = () => api.get('/exams');
export const getExam = (id) => api.get('/exams/'+id);
export const createExam = (data) => api.post('/exams', data);
export const publishExam = (id) => api.post('/exams/'+id+'/publish');
export const cancelExam = (id) => api.post('/exams/'+id+'/cancel');
export const rescheduleExam = (id, data) => api.post('/exams/'+id+'/reschedule', data);
export const deleteExam = (id) => api.delete('/exams/'+id);
export const createBlueprint = (data) => api.post('/blueprints', data);
export const getBlueprints = () => api.get('/blueprints');
/** CHANGE: Delete blueprint */
export const deleteBlueprint = (id) => api.delete('/blueprints/'+id);
export const updateBlueprint = (id, data) => api.put('/blueprints/'+id, data);
