import { Carousel } from 'flowbite-react';
import type { BlogPost } from '../schemas/BlogPost';
import BlogCard from '@/components/BlogCard';

interface BlogCarouselProps {
  posts: {
    id: string;
    data: BlogPost;
  }[];
}

export default function BlogCarousel({ posts }: BlogCarouselProps) {
  if (!posts || posts.length === 0) {
    return null;
  }

  return (
    <Carousel slide={true} slideInterval={5000}>
      {posts.map((post, index) => (
        <BlogCard id={post.id} key={index} horizontal {...post.data} />
      ))}
    </Carousel>
  );
}
