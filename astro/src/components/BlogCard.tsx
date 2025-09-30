import { Card } from 'flowbite-react';
import type { BlogPost } from '../schemas/BlogPost';
interface BlogCardProps extends BlogPost {
  id: string;
  key?: number;
  class?: string;
  horizontal?: boolean;
}

export default async function (props: BlogCardProps) {
  const { id, date, title, description, horizontal } = props;
  const link = `/blog/${id}`;
  const dateObj = new Date(date);
  return (
    <div className="flex h-full items-center justify-center bg-gray-400 dark:bg-gray-700 dark:text-white">
      <Card href={link} imgAlt={title} horizontal={horizontal}>
        <h5 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
          {title}
        </h5>
        <sub>
          Published: {dateObj.toLocaleDateString()}{' '}
          {dateObj.toLocaleTimeString()}
        </sub>
        {description && (
          <p className="font-normal text-gray-700 dark:text-gray-400">
            {description}
          </p>
        )}
      </Card>
    </div>
  );
}
