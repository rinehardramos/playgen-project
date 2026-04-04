export default function NotFound() {
  return (
    <div className="p-8 flex flex-col items-center justify-center min-h-[50vh]">
      <h2 className="text-2xl font-bold text-white mb-4">404 - Page Not Found</h2>
      <p className="text-gray-400 mb-8">The page you are looking for does not exist.</p>
      <a href="/dashboard" className="btn-primary">Go to Dashboard</a>
    </div>
  );
}
