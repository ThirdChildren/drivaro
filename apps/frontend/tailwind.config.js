/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#f8f7f4',
        ink: '#1f2937',
        accent: '#0f766e',
        hot: '#b45309',
      },
      boxShadow: {
        card: '0 20px 40px rgba(15, 23, 42, 0.08)',
      },
      backgroundImage: {
        mesh: 'radial-gradient(circle at 10% 20%, rgba(15,118,110,0.16), transparent 40%), radial-gradient(circle at 90% 10%, rgba(180,83,9,0.14), transparent 35%), linear-gradient(140deg, #f8f7f4 0%, #eef2f2 55%, #f4efe6 100%)',
      },
    },
  },
  plugins: [],
};
