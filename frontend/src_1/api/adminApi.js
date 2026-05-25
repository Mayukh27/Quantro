import api from './axiosConfig';
export const getPendingTeachers = () => api.get('/admin/teachers/pending');
export const getAllTeachers = () => api.get('/admin/teachers');
export const getAllStudents = () => api.get('/admin/students');
export const bulkRegisterStudents = (file) => {
	const formData = new FormData();
	formData.append('file', file);
	return api.post('/admin/students/bulk-register', formData, {
		headers: { 'Content-Type': 'multipart/form-data' }
	});
};
export const approveTeacher = (id) => api.put('/admin/teachers/'+id+'/approve');
export const getStats = () => api.get('/admin/stats');
export const getSubjects = () => api.get('/subjects');
export const createSubject = (data) => api.post('/subjects', data);
/** CHANGE: Delete subject (cascades to questions) */
export const deleteSubject = (id) => api.delete('/subjects/'+id);
export const getQuestions = (subjectId) => api.get('/questions/subject/'+subjectId);
export const uploadQuestion = (data) => api.post('/questions', data);
export const getExamResults = (examId) => api.get('/analytics/exam/'+examId);
export const getExamSummary = (examId) => api.get('/analytics/exam/'+examId+'/summary');
/** CHANGE: Results viewer endpoints */
export const getExamsWithResults = () => api.get('/results/exams');
export const getExamStudentResults = (examId) => api.get('/results/exam/'+examId+'/students');
export const evaluateExamResults = (examId) => api.post('/results/exam/' + examId + '/evaluate');
export const downloadExamStudentResultsExcel = (examId) =>
	api.get('/results/exam/' + examId + '/students/excel', { responseType: 'blob' });
