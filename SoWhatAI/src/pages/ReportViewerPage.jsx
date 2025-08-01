import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient'; // Make sure this path is correct
import { AnalysisReportPage } from './AnalysisToolPage'; // Re-use the report display!

const ReportViewerPage = ({ projectId, onNavigate }) => {
    const [reportData, setReportData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchReport = async () => {
            if (!projectId) {
                setError("No project ID provided.");
                setIsLoading(false);
                return;
            }

            setIsLoading(true);
            const { data, error } = await supabase
                .from('projects')
                .select('analysis_report, dataset') // Assuming you also saved the 'dataSet' info
                .eq('id', projectId)
                .single(); // Use .single() because we expect only one result

            if (error) {
                console.error("Error fetching report:", error);
                setError(error.message);
            } else {
                setReportData(data);
            }
            setIsLoading(false);
        };

        fetchReport();
    }, [projectId]);

    if (isLoading) {
        return <div className="text-center p-10"><p>Loading your report...</p></div>;
    }

    if (error) {
        return <div className="text-center p-10 text-red-400"><p>Error: {error}</p></div>;
    }

    if (!reportData) {
        return <div className="text-center p-10"><p>Could not find the requested report.</p></div>;
    }

    return (
        <AnalysisReportPage
            dataSet={reportData.analysis_report.dataSet || []} // Pass the data set
            results={reportData.analysis_report} // Pass the analysis results
            onBack={() => onNavigate('dashboard')} // Provide a way to go back
            onDownload={() => { /* Implement download logic here */ }}
        />
    );
};

export default ReportViewerPage;
