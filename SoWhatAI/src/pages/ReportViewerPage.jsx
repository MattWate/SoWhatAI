import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { AnalysisReportPage } from './AnalysisToolPage';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

const ReportViewerPage = ({ projectId, onNavigate }) => {
    const [reportData, setReportData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isDownloading, setIsDownloading] = useState(false); // To show loading state on button
    const [error, setError] = useState(null);
    const reportPrintRef = useRef(null); // Ref to the component we want to print

    useEffect(() => {
        // ... (The useEffect to fetch data remains exactly the same)
        const fetchReport = async () => {
            if (!projectId) {
                setError("No project ID provided.");
                setIsLoading(false);
                return;
            }
            setIsLoading(true);
            const { data, error } = await supabase.from('projects').select('analysis_report').eq('id', projectId).single();
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

    const generatePdf = () => {
        if (!reportPrintRef.current) return;
        setIsDownloading(true);

        html2canvas(reportPrintRef.current, { 
            useCORS: true, 
            scale: 2 // Increase scale for better resolution
        }).then(canvas => {
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'px',
                format: [canvas.width, canvas.height]
            });

            pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);

            const fileName = reportData.analysis_report.researchQuestion
                .substring(0, 30).replace(/[^a-z0-9]/gi, '_').toLowerCase();

            pdf.save(`sowhat_report_${fileName || 'project'}.pdf`);
            setIsDownloading(false);
        });
    };

    if (isLoading) {
        return <div className="text-center p-10"><p>Loading your report...</p></div>;
    }
    if (error) {
        return <div className="text-center p-10 text-red-400"><p>Error: {error}</p></div>;
    }
    if (!reportData) {
        return <div className="text-center p-10"><p>Could not find the requested report.</p></div>;
    }

    // We wrap the report in a div with a ref, and pass the new generatePdf function
    return (
        <div ref={reportPrintRef}>
            <AnalysisReportPage
                dataSet={reportData.analysis_report.dataSet || []}
                results={reportData.analysis_report}
                onBack={() => onNavigate('dashboard')}
                onDownload={generatePdf}
                isDownloading={isDownloading} // Pass downloading state to the button
            />
        </div>
    );
};

export default ReportViewerPage;
