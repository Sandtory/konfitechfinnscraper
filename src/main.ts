// Apify SDK - toolkit for building Apify Actors (Read more at https://docs.apify.com/sdk/js/)
import { Actor } from 'apify';
// Crawlee - web scraping and browser automation library (Read more at https://crawlee.dev)
import { CheerioCrawler, Dataset, createCheerioRouter, EnqueueStrategy, Request } from 'crawlee';
// this is ESM project, and as such, it requires you to specify extensions in your relative imports
// read more about this here: https://nodejs.org/docs/latest-v18.x/api/esm.html#mandatory-file-extensions
// note that we need to use `.js` even when inside TS files
// import { router } from './routes.js';

// Define the input schema for the actor
interface Input {
    searchUrl: string;
    maxJobs: number;
}

// Define the job data structure
interface JobData {
    url: string;
    title: string;
    description: string;
    company: string;
    contactPerson?: string;
    phoneNumber?: string;
    email?: string;
    applicationUrl?: string;
    location?: string;
    employmentType?: string;
    salary?: string;
    publicationDate?: string;
    expirationDate?: string;
    finnkode?: string;
    companyLogoUrl?: string;
}

// Initialize the Actor
await Actor.init();

// Get input from the user
const input = await Actor.getInput<Input>();
const searchUrl = input?.searchUrl || 'https://www.finn.no/job/fulltime/search.html?occupation=0.23&occupation=0.22';
const maxJobs = input?.maxJobs || 100;

console.log('Starting crawler with URL:', searchUrl);

// Set up proxy configuration
const proxyConfiguration = await Actor.createProxyConfiguration();

// Create a counter to track how many jobs we've scraped
let scrapedJobsCount = 0;

// Create a router for handling different URL patterns
const router = createCheerioRouter();

// Handle the search results page
router.addHandler('LIST', async ({ request, $, log, enqueueLinks }) => {
    log.info(`Processing search results page ${request.url}`);
    
    // Verify this is actually a Finn.no search page
    if (!request.url.includes('finn.no')) {
        log.warning(`Skipping non-Finn.no URL: ${request.url}`);
        return;
    }
    
    // Debug: Log the raw HTML to check what we're getting
    log.info('HTML structure check:', {
        bodyLength: $('body').html()?.length || 0,
        hasJobsList: Boolean($('.ads__unit').length || $('.f-card').length || $('.sf-search-ad').length),
        possibleJobSelectors: {
            adsUnit: $('.ads__unit').length,
            fCard: $('.f-card').length,
            searchAd: $('.sf-search-ad').length,
            genericAnchor: $('a[href*="/job/fulltime/ad.html"]').length
        }
    });
    
    // Try multiple selector patterns to find job listings
    let jobLinks = $('.ads__unit > .ads__unit__link'); // Original selector
    
    // If the original selector doesn't find anything, try alternative selectors
    if (jobLinks.length === 0) {
        jobLinks = $('.f-card--job a');
    }
    
    if (jobLinks.length === 0) {
        jobLinks = $('.sf-search-ad a');
    }
    
    if (jobLinks.length === 0) {
        jobLinks = $('a[href*="/job/fulltime/ad.html"]');
    }
    
    log.info(`Found ${jobLinks.length} job listings on this page`);
    
    // Check if we've reached the maximum number of jobs
    const remainingJobs = maxJobs - scrapedJobsCount;
    
    if (remainingJobs <= 0) {
        log.info('Reached the maximum number of jobs to scrape. Stopping the crawler.');
        return;
    }
    
    // If we found links using a generic selector, enqueue them directly
    if (jobLinks.length > 0 && $('a[href*="/job/fulltime/ad.html"]').length > 0) {
        // Get all the href attributes
        const urls: string[] = [];
        jobLinks.each((_, element) => {
            const href = $(element).attr('href');
            if (href && href.includes('/job/fulltime/ad.html')) {
                // Make absolute URL if it's relative
                const url = href.startsWith('http') ? href : `https://www.finn.no${href}`;
                urls.push(url);
            }
        });
        
        // Enqueue the URLs directly
        for (let i = 0; i < Math.min(urls.length, remainingJobs); i++) {
            await crawler.addRequests([{
                url: urls[i],
                label: 'DETAIL'
            }]);
        }
        
        log.info(`Directly enqueued ${Math.min(urls.length, remainingJobs)} job detail pages`);
    } else {
        // Enqueue individual job detail pages using the enqueueLinks method
        await enqueueLinks({
            selector: jobLinks.length > 0 ? jobLinks.toString() : 'a[href*="/job/fulltime/ad.html"]',
            label: 'DETAIL',
            limit: remainingJobs,
            transformRequestFunction: (req) => {
                // Ensure we always have a label
                req.label = 'DETAIL';
                return req;
            },
        });
    }
    
    // Find pagination links
    let paginationLinks = $('a.pagination__page');
    
    if (paginationLinks.length === 0) {
        paginationLinks = $('a[href*="page="]');
    }
    
    // Enqueue next page if we need more jobs
    if (remainingJobs > jobLinks.length && paginationLinks.length > 0) {
        log.info(`Found ${paginationLinks.length} pagination links, enqueueing next pages`);
        await enqueueLinks({
            selector: paginationLinks.length > 0 ? paginationLinks.toString() : 'a[href*="page="]',
            strategy: EnqueueStrategy.All,
            label: 'LIST',
            transformRequestFunction: (req) => {
                // Ensure we always have a label
                req.label = 'LIST';
                return req;
            },
        });
    }
});

// Handle the job detail page
router.addHandler('DETAIL', async ({ request, $, log }) => {
    log.info(`Processing job detail page ${request.url}`);
    
    try {
        // Extract the finnkode (job ID) from the URL
        const finnkodeMatch = request.url.match(/finnkode=(\d+)/);
        const finnkode = finnkodeMatch ? finnkodeMatch[1] : undefined;
        
        // Extract job title - both main title and subtitle
        const mainTitle = $('h2.t2, h2.t3, h1.t2, h1.t3, .t2, .t1').first().text().trim();
        const subTitle = $('h1').first().text().trim();
        const title = mainTitle || subTitle;
        
        // Extract company name
        const company = $('a[href*="/employer/company/"]').text().trim() || 
                      $('p:contains("ASA"), p:contains("AS")').first().text().trim();
        
        // Extract company logo URL
        const companyLogoUrl = $('.company-logo img, img[alt*="logo"]').attr('src') || undefined;
        
        // Get the main job description
        const descriptionSection = $('section[aria-label="Jobbdetaljer"]').html() || 
                                 $('.import-decoration').html() || 
                                 $('section:contains("En vanlig arbeidsdag")').html();
        const description = descriptionSection || '';
        
        // Extract contact information
        const jobDetailsText = $('body').text();
        
        // Use regex to find email addresses in the content
        const emailRegex = /[\w.-]+@[\w.-]+\.\w+/;
        const emailMatch = jobDetailsText.match(emailRegex);
        const email = emailMatch ? emailMatch[0] : undefined;
        
        // Use regex to find phone numbers in the content
        const phoneRegex = /\+?\d[\d\s\-]{7,}/;
        const phoneMatch = jobDetailsText.match(phoneRegex);
        
        // Try to find phone from structured data
        let phoneNumber = undefined;
        if ($('span.pr-8.font-bold:contains("Mobil")').length > 0) {
            phoneNumber = $('span.pr-8.font-bold:contains("Mobil")').next('a').text().trim();
        } else if (phoneMatch) {
            phoneNumber = phoneMatch[0].trim();
        }
        
        // Find contact person
        let contactPerson = undefined;
        if ($('span.pr-8.font-bold:contains("Kontaktperson")').length > 0) {
            contactPerson = $('span.pr-8.font-bold:contains("Kontaktperson")').next().text().trim();
        } else if ($('li:contains("Kontaktperson")').length > 0) {
            contactPerson = $('li:contains("Kontaktperson")').text().replace('Kontaktperson', '').trim();
        }
        
        // Extract application URL - look for "Søk" or "Apply" buttons
        const applicationUrl = $('a:contains("Søk"), a:contains("Apply"), a.button--attention').attr('href') || undefined;
        
        // Find location information
        let location = undefined;
        if ($('span.pr-8.font-bold:contains("Sted")').length > 0) {
            location = $('span.pr-8.font-bold:contains("Sted")').next().text().trim();
        } else if ($('li:contains("Sted")').length > 0) {
            location = $('li:contains("Sted")').text().replace('Sted', '').trim();
        } else {
            // Try to extract postal code and city from any available address
            const addressText = $('section:contains("Firmaets beliggenhet") p').text().trim();
            if (addressText) {
                location = addressText;
            }
        }
        
        // Find employment type
        let employmentType = undefined;
        const employmentTypeLabels = [
            'Fast', 'Deltid', 'Heltid', 'Engasjement', 'Prosjekt', 'Sesong',
            'Vikariat', 'Franchise', 'Selvstendig næringsdrivende', 'Timebasert'
        ];
        
        for (const label of employmentTypeLabels) {
            if (jobDetailsText.includes(label)) {
                employmentType = label;
                break;
            }
        }
        
        if (!employmentType && $('li:contains("Ansettelsesform")').length > 0) {
            employmentType = $('li:contains("Ansettelsesform")').text().replace('Ansettelsesform', '').trim();
        }
        
        // Find deadlines and publication dates
        let expirationDate = undefined;
        if ($('li:contains("Frist")').length > 0) {
            expirationDate = $('li:contains("Frist")').find('.font-bold').text().trim();
        } else if ($('span:contains("Frist")').length > 0) {
            expirationDate = $('span:contains("Frist")').parent().text().replace('Frist', '').trim();
        }
        
        // Get publication date from metadata
        const publicationDateElement = $('time[datetime]');
        const publicationDate = publicationDateElement.length > 0 
            ? publicationDateElement.attr('datetime') 
            : $('li:contains("Sist endret")').text().replace('Sist endret', '').trim();
        
        // Create the job data object
        const jobData: JobData = {
            url: request.url,
            title,
            description,
            company,
            contactPerson,
            phoneNumber,
            email,
            applicationUrl,
            location,
            employmentType,
            publicationDate,
            expirationDate,
            finnkode,
            companyLogoUrl
        };
        
        log.info('Extracted job data:', { title, company, finnkode });
        
        // Save the job data to the dataset
        await Dataset.pushData(jobData);
        
        // Increment the counter for scraped jobs
        scrapedJobsCount++;
        
        log.info(`Successfully scraped job: ${title}`);
    } catch (error) {
        log.error(`Error processing job detail page ${request.url}`, { error: (error as Error).message });
        // Continue with the next job even if there's an error
    }
});

// Add a default handler for any URLs that don't match other patterns
router.addDefaultHandler(async ({ request, log }) => {
    log.info(`Received unexpected URL: ${request.url}`);
    
    // If it's from finn.no, try to determine what type it is
    if (request.url.includes('finn.no')) {
        if (request.url.includes('/search.html')) {
            log.info(`This appears to be a search page, but wasn't properly labeled: ${request.url}`);
        } else if (request.url.includes('/ad.html')) {
            log.info(`This appears to be a detail page, but wasn't properly labeled: ${request.url}`);
        }
    } else {
        log.warning(`Skipping non-Finn.no URL: ${request.url}`);
    }
});

// Create and configure the crawler
const crawler = new CheerioCrawler({
    proxyConfiguration,
    maxConcurrency: 10,
    requestHandler: router,
    // Add error handling to be robust against website changes
    failedRequestHandler: async ({ request, log }) => {
        log.warning(`Request ${request.url} failed`);
    },
});

// Start with the search URL provided in the input
await crawler.run([
    new Request({
        url: searchUrl,
        label: 'LIST'
    })
]);

// Gracefully exit the Actor process. It's recommended to quit all Actors with an exit()
await Actor.exit();
